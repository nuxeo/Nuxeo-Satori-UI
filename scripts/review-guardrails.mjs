#!/usr/bin/env node
import ts from 'typescript';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  encoding: 'utf8',
  maxBuffer: 1024 * 1024,
}).trim();

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (arg.startsWith('--')) {
    const [key, inlineValue] = arg.slice(2).split('=', 2);
    if (inlineValue !== undefined) {
      args.set(key, inlineValue);
    } else {
      args.set(key, process.argv[i + 1]?.startsWith('--') ? true : process.argv[++i]);
    }
  }
}

const base = args.get('base') || process.env.NX_BASE || 'origin/main';
const head = args.get('head') || process.env.NX_HEAD || 'HEAD';

const GIT_MAX_BUFFER = 50 * 1024 * 1024;

function git(args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: GIT_MAX_BUFFER });
}

function fileExists(path) {
  return existsSync(join(repoRoot, path));
}

function read(path) {
  // Normalise CRLF line endings only (`\r\n` → `\n`), repository-wide, so workflow matchers see
  // Unix line ends on Windows checkouts. Do not strip every `\r`: that can remove raw carriage
  // returns inside JSON string values and turn a runtime `JSON.parse` failure into a pass here.
  // Catalogues are validated in `checkTranslationCatalogues`, which reads through this helper and
  // fails on `JSON.parse` — illegal control characters inside strings stay invalid; `\r` as JSON
  // whitespace between tokens remains legal.
  return readFileSync(join(repoRoot, path), 'utf8').replace(/\r\n/g, '\n');
}

function toPosixRel(rel) {
  return rel.replace(/\\/g, '/');
}

function walk(dir, predicate, acc = []) {
  const absolute = join(repoRoot, dir);
  if (!existsSync(absolute)) return acc;
  for (const entry of readdirSync(absolute)) {
    const path = join(absolute, entry);
    const rel = toPosixRel(relative(repoRoot, path));
    if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue;
    if (statSync(path).isDirectory()) {
      walk(rel, predicate, acc);
    } else if (predicate(rel)) {
      acc.push(rel);
    }
  }
  return acc;
}

/**
 * The commit the branch diverged from, or `base` itself if that cannot be resolved.
 *
 * `git diff a...b` already means "from the merge base of a and b, to b". The dirty-tree path
 * below cannot use three-dot form — there is no committed `b` to name — so it has to compute
 * the same starting point explicitly, or the two paths mean different things.
 */
function mergeBaseOrBase() {
  try {
    return git(['merge-base', base, head]).trim() || base;
  } catch {
    // A fixture repository without the base ref, or a shallow clone. Falling back to `base` is
    // the previous behaviour, which is noisy rather than wrong.
    return base;
  }
}

/**
 * Added lines, keyed by file.
 *
 * ## The two paths have to mean the same thing, and once did not
 *
 * Clean tree: `git diff base...head` — **merge base** to head, so commits that landed on `base`
 * after this branch forked are excluded.
 *
 * Dirty tree: it used `git diff base`, which is two-dot — working tree against the **current
 * tip** of base. Those differ the moment `base` moves on, and the difference is not subtle: a
 * line that `main` changed *after* the fork shows up as this branch having added the old
 * version of it. Measured on this branch with `origin/main` a few commits ahead: four
 * guardrail failures, all of them lines nobody here had touched, all of them vanishing when
 * the tree was made clean. A gate that cries wolf whenever `main` moves is a gate people learn
 * to run with their eyes closed.
 *
 * So the dirty path now starts from the merge base too. Both paths answer the same question —
 * "what has this branch introduced" — and the only difference left is whether uncommitted work
 * counts, which is the distinction that was intended.
 */
function parseDiff() {
  const hasLocalChanges = head === 'HEAD' && git(['status', '--porcelain']).trim().length > 0;
  const diffArgs = hasLocalChanges
    ? ['diff', '--unified=0', '--diff-filter=ACMR', mergeBaseOrBase()]
    : ['diff', '--unified=0', '--diff-filter=ACMR', `${base}...${head}`];
  const diff = git(diffArgs);
  const files = new Map();
  let current = null;
  let newLine = 0;

  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ b/')) {
      current = line.slice(6);
      if (!files.has(current)) files.set(current, []);
      continue;
    }
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      newLine = Number(hunk[1]);
      continue;
    }
    if (!current) continue;
    if (line.startsWith('+') && !line.startsWith('+++')) {
      files.get(current).push({ line: newLine, text: line.slice(1) });
      newLine += 1;
    } else if (!line.startsWith('-')) {
      newLine += 1;
    }
  }
  return files;
}

const addedLinesByFile = parseDiff();
const changedFiles = [...addedLinesByFile.keys()];
const failures = [];
const warnings = [];

function fail(message) {
  failures.push(message);
}

function warn(message) {
  warnings.push(message);
}

/**
 * The line numbers of a `.ts` file that fall inside an inline `template:` or `styles:` value.
 *
 * ## Why this exists
 *
 * `checkThemeTokens` used to read `.scss` and `.html` only, so a colour written inside a
 * component's inline template was never colour-checked at all. That is how 42 hard-coded colours
 * accumulated in `contracts-page.component.ts` unnoticed, and became visible the moment the
 * template was moved to a `.html` sibling — the violations were not introduced by the move, only
 * measured by it. It is also the second, independent reason `templateUrl` is a stated convention:
 * an inline template is invisible to every tool that keys off the file extension.
 *
 * ## The scoping, and why it is the block and not the file
 *
 * Only the text between the backticks of a `template:`/`styles:` value is returned. The colour
 * pattern is `#[0-9a-fA-F]{3,8}`, and a `.ts` file legitimately carries hex-shaped literals that
 * are not colours — a commit SHA, a document uid, a fixture id, an `&#123;` entity. Scanning the
 * whole file would flag all of them. Inside a template or a styles block the same literal is CSS,
 * so there the match is real.
 *
 * The block is found by walking forward from the key: optional `[`, then each backtick literal in
 * turn, stopping at the closing `]` or at the first value that is not a literal, so
 * `template: SOME_CONST` is not scanned. `templateUrl:`, `styleUrl:` and `styleUrls:` do not match
 * the key — a component that follows the convention has nothing here to scan.
 *
 * ## What it does not claim
 *
 * A backtick inside a `${…}` interpolation ends the literal early, so coverage stops there. That
 * under-covers rather than over-flags, and no template in this repository has that shape.
 */
function inlineStyleBlockLines(source) {
  const lineStarts = [0];
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] === '\n') lineStarts.push(i + 1);
  }
  const lineAt = (index) => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (lineStarts[mid] <= index) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  };

  const covered = new Set();
  for (const key of source.matchAll(/(?:^|[\s,{(])(?:template|styles)\s*:/g)) {
    let i = key.index + key[0].length;
    while (i < source.length && /\s/.test(source[i])) i += 1;
    const isArray = source[i] === '[';
    if (isArray) i += 1;

    for (;;) {
      while (i < source.length && /[\s,]/.test(source[i])) i += 1;
      if (source[i] !== '`') break;
      i += 1;
      const opened = lineAt(i);
      while (i < source.length && source[i] !== '`') {
        if (source[i] === '\\') i += 1;
        i += 1;
      }
      const closed = lineAt(Math.min(i, source.length - 1));
      for (let line = opened; line <= closed; line += 1) covered.add(line);
      i += 1;
      if (!isArray) break;
    }
  }
  return covered;
}

/**
 * A colour literal must come from a **theme token with a fallback**, not be typed
 * in at the point of use.
 *
 * Three token namespaces are recognised, and the third needs explaining.
 * `--mat-sys-*` is Angular Material's, `--kd-*` is Knowledge Discovery's, and
 * `--shell-*` is `apps/nuxeo-satori-template`'s. The template ships **no Angular
 * Material on purpose** — a fork should not have to remove our design system
 * before adding its own — so `--mat-sys-*` is undefined there and writing
 * `var(--mat-sys-surface, #fff)` would satisfy this gate while the fallback did
 * all the work. That is the tautological-gate failure this repo has already paid
 * for twice, so the namespace is recognised rather than faked. `--shell-*` is
 * genuinely themed: `TemplateThemeService` writes Layer 0 `themes[].tokens` onto
 * `<html>`, verified in a browser against the built bundle.
 *
 * A **custom property declaration** is exempt. `--shell-border: #d0d7de;` is the
 * one place a literal belongs, because defining the token is precisely how every
 * other line avoids hardcoding. The exemption is deliberately narrow: the line
 * must be a declaration of a `--*` property, so `color: #fff` is still caught
 * wherever it appears.
 */
function checkThemeTokens() {
  const colorLiteral = /#[0-9a-fA-F]{3,8}\b|rgba?\(/;
  const THEMED_NAMESPACES = ['var(--mat-sys-', 'var(--kd-', 'var(--shell-'];
  // A design-token definition, e.g. `--shell-nav-bg: #0f2b46;`.
  const tokenDefinition = /^--[a-z0-9-]+\s*:/;

  for (const [file, lines] of addedLinesByFile) {
    // A whole stylesheet or template is CSS; a `.ts` file is only CSS inside its inline
    // `template:`/`styles:` blocks, so it is narrowed to those. See `inlineStyleBlockLines`.
    let inlineBlock = null;
    if (!file.endsWith('.scss') && !file.endsWith('.html')) {
      if (!file.endsWith('.ts') || !fileExists(file)) continue;
      inlineBlock = inlineStyleBlockLines(read(file));
      if (inlineBlock.size === 0) continue;
    }
    for (const { line, text } of lines) {
      if (inlineBlock && !inlineBlock.has(line)) continue;
      const trimmed = text.trim();
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;
      if (tokenDefinition.test(trimmed)) continue;
      const hasColor = colorLiteral.test(trimmed);
      const isThemed = THEMED_NAMESPACES.some((namespace) => trimmed.includes(namespace));
      if (hasColor && !isThemed) {
        fail(
          `${file}:${line} introduces a hard-coded color. Use a theme token with a fallback ` +
            `(--mat-sys-*, --kd-*, or --shell-* in the template), or declare it as a --* token.` +
            (inlineBlock
              ? '\n    It is inside an inline template/styles block. Move it to a sibling ' +
                '.html/.scss and reference it with templateUrl/styleUrl, which is the convention ' +
                'and is also what makes the rest of the tooling able to see it.'
              : ''),
        );
      }
    }
  }
}

function checkDocsNumbering() {
  const docFiles = changedFiles.filter((file) => file.endsWith('.md') && file.startsWith('docs/'));
  for (const file of docFiles) {
    if (!fileExists(file)) continue;
    const numbers = new Map();
    // Track fenced code blocks: several docs embed whole other documents (AGENTS.md,
    // rule files) inside ```` fences, and those inner headings are illustrative content,
    // not this document's structure. A closing fence must be at least as long as the
    // one that opened the block, so nested ``` inside ```` does not end it.
    let openFence = 0;
    read(file)
      .split('\n')
      .forEach((line, index) => {
        const fence = line.match(/^\s*(`{3,}|~{3,})/);
        if (fence) {
          const length = fence[1].length;
          if (openFence === 0) {
            openFence = length;
            return;
          }
          if (length >= openFence && !line.trim().slice(length).trim()) {
            openFence = 0;
          }
          return;
        }
        if (openFence > 0) return;
        const match = line.match(/^##\s+(\d+)\./);
        if (!match) return;
        const section = match[1];
        const lines = numbers.get(section) || [];
        lines.push(index + 1);
        numbers.set(section, lines);
      });
    for (const [section, lines] of numbers) {
      if (lines.length > 1) {
        fail(`${file} has duplicate section number ## ${section}. at lines ${lines.join(', ')}.`);
      }
    }
  }
}

/**
 * Review bookkeeping must not travel in a pull request.
 *
 * `pr-review-analysis.mjs publish` used to write four tracked files as well as posting to the
 * Confluence analysis page: `docs/pr-review-findings.jsonl`, and the regenerated
 * `pre-pr-review/SKILL.md` in `.cursor/` plus its `.claude/` and `.agent/` mirrors. It runs
 * inside the review loop, and the retired `review-corpus` gate then required all four to be
 * committed with the fix — so a two-line accessibility fix shipped with four files of review
 * bookkeeping, on every PR that took a review round.
 *
 * The page is the record now and `publish` writes nothing tracked. This check is what keeps it
 * that way, because the failure mode is not someone arguing for the corpus again: it is a
 * generator, a stale instruction in a skill, or a restored file quietly putting it back.
 *
 * Both halves are load-bearing and neither implies the other. The path check catches the
 * corpus file returning under its own name; the marker check catches the generated statistics
 * block returning to any file, including under a different name, which is the form the path
 * check cannot see.
 */
function checkNoReviewCorpusChurn() {
  const CORPUS = 'docs/pr-review-findings.jsonl';
  if (changedFiles.includes(CORPUS)) {
    fail(
      `${CORPUS} is back in the diff. The PR review findings live on the Confluence analysis ` +
        'page, not in the repository — `npm run review:analysis -- stats` reads them. A ' +
        'committed copy is churn on every unrelated PR, and it fell behind the page every time.',
    );
  }
  // Split so this file can describe the marker without matching itself. Checking the added
  // lines rather than the file contents is deliberate: it is the reintroduction that fails,
  // and an unrelated PR is never blamed for a marker it did not add.
  const MARKER = `pr-review-stats${':'}start`;
  for (const [file, lines] of addedLinesByFile) {
    const hit = lines.find((line) => line.text.includes(MARKER));
    if (hit) {
      fail(
        `${file}:${hit.line} adds a generated \`${MARKER}\` block. The pre-PR review skill ` +
          'quotes no counts on purpose: an embedded table is a second copy of a number that ' +
          'only grows, and keeping it in step is what put the skill and its two mirrors into ' +
          'every PR diff. Point at the page instead.',
      );
    }
  }
}

function checkVitestProjects() {
  const projectFiles = walk('.', (file) => file.endsWith('project.json'));
  for (const projectFile of projectFiles) {
    let project;
    try {
      project = JSON.parse(read(projectFile));
    } catch {
      continue;
    }
    if (project?.targets?.test?.executor !== '@nx/vitest:test') continue;

    const projectRoot = dirname(projectFile);
    const sourceRoot = project.sourceRoot || join(projectRoot, 'src');
    const hasViteConfig = [
      'vite.config.ts',
      'vite.config.mts',
      'vite.config.js',
      'vitest.config.ts',
      'vitest.config.mts',
    ].some((config) => fileExists(join(projectRoot, config)));
    if (!hasViteConfig) {
      fail(`${projectFile} has an @nx/vitest:test target but no Vite/Vitest config file.`);
      continue;
    }

    const specs = walk(sourceRoot, (file) => /\.(spec|test)\.(ts|tsx|js|jsx|mts|mjs)$/.test(file));
    if (specs.length === 0) {
      const viteConfig = [
        'vite.config.ts',
        'vite.config.mts',
        'vite.config.js',
        'vitest.config.ts',
        'vitest.config.mts',
      ]
        .map((config) => join(projectRoot, config))
        .find(fileExists);
      const configText = viteConfig ? read(viteConfig) : '';
      if (!/passWithNoTests:\s*true/.test(configText)) {
        fail(
          `${projectFile} has no specs under ${sourceRoot}; add tests or set passWithNoTests: true.`,
        );
      }
    }
  }
}

/**
 * Every file that creates an object URL must also revoke one — repo-wide, not diff-wide.
 *
 * ## Why this stopped being diff-scoped
 *
 * It used to iterate `addedLinesByFile`, so it only ever looked at files whose *added*
 * lines contained `URL.createObjectURL`. That makes every violation predating the check
 * permanently exempt: it is not a rule, it is a rule for new code. Four real leaks lived
 * behind that exemption — two in `nav-drawer.component.ts`, one in
 * `dashboard-page.component.ts`, one in `collection-detail.ts`, none of which revoked
 * anything at all — while this gate reported pass on every run. CLAUDE.md states the
 * blob-URL lifecycle as a non-negotiable; a check that cannot see existing code cannot
 * hold it.
 *
 * Repo-wide is affordable because the population is tiny (18 files today) and the check is
 * a substring test.
 *
 * ## What it deliberately does not claim
 *
 * Granularity is the **file**, not the call site. A file that revokes on destroy but leaks
 * on a mid-life reset still passes — which is a real bug shape, and
 * `collection-detail.ts` had exactly it: `thumbnailMap.set({})` dropped a batch of
 * `SafeUrl`s without revoking the blobs behind them. Proving that by regex is not
 * possible, so it is stated here rather than implied by a green tick.
 */
function checkBlobUrlLifecycle() {
  const files = git(['ls-files', '--cached', '--others', '--exclude-standard'])
    .split('\n')
    .filter((file) => /^(libs|apps)\/.+\.ts$/.test(file) && !/\.(spec|test)\.ts$/.test(file));

  if (files.length === 0) {
    fail('No TypeScript sources found, so the blob-URL lifecycle gate cannot verify anything.');
    return;
  }

  let creators = 0;
  for (const file of files) {
    if (!fileExists(file)) continue;
    const content = read(file);
    if (!content.includes('URL.createObjectURL')) continue;
    creators += 1;
    if (!content.includes('URL.revokeObjectURL')) {
      fail(
        `${file} creates Blob/Object URLs but never revokes one.\n` +
          '    Track the raw url at creation — a SafeUrl from bypassSecurityTrustUrl cannot be\n' +
          '    read back — and revoke in destroyRef.onDestroy and on any reset.',
      );
    }
  }

  if (creators === 0) {
    fail(
      'No file creates an object URL, so this gate asserted nothing. If that is genuinely ' +
        'true the check should be removed deliberately rather than left passing empty.',
    );
  }
}

/**
 * The other half of the same rule: `<img [src]>` must never be handed a Nuxeo URL.
 *
 * CLAUDE.md states it — "Never `<img [src]="nuxeoUrl">` — fetch via service, use a blob
 * URL, revoke on destroy" — and nothing checked it. `task-detail.component.html` bound
 * `[src]="docPreviewUrl()"` where the component returned
 * `nuxeoApi.apiUrl('/nuxeo/api/v1/id/…/@rendition/thumbnail')`, so the browser issued that
 * request itself: no HTTP interceptor, no `Authorization` header, working only on an
 * ambient session cookie, with an internal API URL sitting in the DOM. Its sibling
 * `tasks-page.component.ts` in the same library already did it correctly.
 *
 * Matched on the **component**, not the template, because the template only shows a getter
 * name — `[src]="thumb"` is correct when `thumb` is a blob URL and wrong when it is not,
 * and only the `.ts` says which. So: for each expression bound to `[src]`, find its
 * declaration in the sibling component and fail if that declaration builds a Nuxeo URL.
 *
 * Two limits, stated rather than implied: it looks only at the sibling `.ts` of the same
 * base name, and it reads four lines from the declaration. A getter that delegates to a
 * helper elsewhere would slip through. It catches the shape that actually occurred.
 */
function checkNoNuxeoUrlInImgSrc() {
  const templates = git(['ls-files', '--cached', '--others', '--exclude-standard'])
    .split('\n')
    .filter((file) => /^(libs|apps)\/.+\.html$/.test(file));

  let bindings = 0;
  for (const template of templates) {
    if (!fileExists(template)) continue;
    const component = template.replace(/\.html$/, '.ts');
    if (!fileExists(component)) continue;
    const body = read(component);

    for (const match of read(template).matchAll(/\[src\]="([^"]+)"/g)) {
      // `foo()` and `foo` both reduce to the member name `foo`.
      const member = match[1]
        .replace(/\(.*$/, '')
        .replace(/^this\./, '')
        .trim();
      if (!/^[A-Za-z_$][\w$]*$/.test(member)) continue;
      bindings += 1;

      const declaration = new RegExp(`^\\s*(?:readonly\\s+)?${member}\\b[^\\n]*$`, 'm').exec(body);
      if (!declaration) continue;
      const window = body.slice(declaration.index).split('\n').slice(0, 5).join('\n');
      if (/apiUrl\(|['"`]\/nuxeo\//.test(window)) {
        fail(
          `${template} binds [src]="${match[1]}", and ${component} builds that from a Nuxeo URL.\n` +
            '    The browser fetches it directly, so it bypasses the HTTP interceptor and carries\n' +
            '    no Authorization header. Fetch the blob through a service, hand the template a\n' +
            '    blob URL, and revoke it on destroy.',
        );
      }
    }
  }

  if (bindings === 0) {
    fail(
      'No [src] bindings were found in any template, so this gate asserted nothing. ' +
        'Check the template glob before trusting a pass.',
    );
  }
}

/**
 * `attr.foo="bar"` written as a plain attribute, without Angular's binding brackets.
 *
 * The `attr.` prefix is only meaningful inside `[...]`. Written bare it is not a binding at all:
 * Angular emits a DOM attribute whose literal name is `attr.aria-label`, so
 *
 *     <button attr.aria-label="Download {{ view.title }}">
 *
 * renders `attr.aria-label="Download report.pdf"` and the button has **no accessible name**. It
 * looks correct in review, the interpolation really does evaluate, and the result is invisible
 * to assistive technology. There is no case where the bare form is what was meant.
 *
 * ## Why this needs its own check
 *
 * Nothing else in the toolchain sees it, and that was verified rather than assumed:
 *
 *   - the eleven @angular-eslint/template accessibility rules report nothing, because
 *     `attr.aria-label` is not an `aria-*` attribute and `valid-aria` never looks at it
 *   - SonarCloud reports nothing (it flags `Web:S6819` and `InputWithoutLabelCheck` elsewhere,
 *     not this)
 *   - the Angular compiler is happy: a literal attribute with an interpolation is valid HTML
 *
 * The one instance in this repository shipped through code review, a full WCAG 2.1 AA phase and
 * two CI gates. It was found by an external reviewer reading the diff.
 *
 * Scoped to `aria-`, `role` and `title` — the attributes where a silent miss costs an accessible
 * name. A bare `attr.colspan` is also wrong but merely cosmetic, and keeping the pattern narrow
 * keeps it free of judgement calls.
 */
function checkNoAttrPrefixedLiteralAttributes() {
  const templates = git(['ls-files', '--cached', '--others', '--exclude-standard'])
    .split('\n')
    .filter((file) => /^(libs|apps)\/.+\.html$/.test(file));

  let scanned = 0;
  for (const template of templates) {
    if (!fileExists(template)) continue;
    scanned += 1;

    read(template)
      .split('\n')
      .forEach((line, index) => {
        // A preceding `[` means it is the correct `[attr.foo]="…"` binding form.
        for (const match of line.matchAll(/(.?)\battr\.((?:aria-[\w-]+)|role|title)\s*=/g)) {
          if (match[1] === '[') continue;
          fail(
            `${template}:${index + 1} writes attr.${match[2]}="…" without binding brackets.\n` +
              `    The attr. prefix only works inside [...]. As written, Angular renders a DOM\n` +
              `    attribute literally named "attr.${match[2]}", so the element has no ${match[2]}\n` +
              `    at all. Use ${match[2]}="…" for a static value or interpolation, or\n` +
              `    [attr.${match[2]}]="…" to bind an expression.`,
          );
        }
      });
  }

  // The repository's standing rule: a glob that finds nothing must not read as a pass. There are
  // 89 tracked templates; a zero here means the check stopped looking.
  if (scanned === 0) {
    fail(
      'checkNoAttrPrefixedLiteralAttributes scanned no templates at all, so it asserted ' +
        'nothing. Check the template glob before trusting a pass.',
    );
  }
}

function checkTypeSafetyEscapes() {
  for (const [file, lines] of addedLinesByFile) {
    if (!file.endsWith('.ts')) continue;
    for (const { line, text } of lines) {
      if (/\bas unknown as\b|\bas never\b/.test(text)) {
        warn(
          `${file}:${line} uses a broad type escape. Prefer a typed adapter or runtime narrowing.`,
        );
      }
    }
  }
}

/**
 * Credential-shaped literals.
 *
 * Full lengths are required deliberately, so the patterns in this file do not match
 * themselves and neither do prose examples in the docs.
 */
const SECRET_PATTERNS = [
  { name: 'GitHub classic PAT', re: /\bghp_[A-Za-z0-9]{36}\b/ },
  { name: 'GitHub fine-grained PAT', re: /\bgithub_pat_[A-Za-z0-9_]{60,}\b/ },
  { name: 'GitHub OAuth/app/refresh token', re: /\bgh[ousr]_[A-Za-z0-9]{36,}\b/ },
  { name: 'npm access token', re: /\bnpm_[A-Za-z0-9]{36}\b/ },
  { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
];

/**
 * Config files that carry credentials by design, and are tracked, so a literal in
 * one is a commit away from being published.
 */
const CREDENTIAL_CONFIG = /(^|\/)(\.npmrc|\.yarnrc|\.yarnrc\.yml|\.netrc)$/;

/** Anything that sets a secret to a value. */
const SECRET_ASSIGNMENT = /(_authToken|_auth|_password|NPM_TOKEN|NODE_AUTH_TOKEN)\s*[=:]\s*(.+)$/;

/**
 * A value that is a reference rather than a secret: `${VAR}`, `${{ secrets.X }}`,
 * `$VAR`, or an obvious placeholder.
 */
function isIndirect(value) {
  const v = value.trim().replace(/^["']|["'],?$/g, '');
  if (!v) return true;
  if (v.startsWith('${') || v.startsWith('$')) return true;
  if (/^<.*>$/.test(v)) return true; // <REDACTED>, <your-token>
  if (/^(x+|\*+|REDACTED|TODO|CHANGEME|placeholder)$/i.test(v)) return true;
  return false;
}

/**
 * Why this exists: a real `ghp_` token replaced `${SATORI_GH_READONLY_TOKEN}` in the
 * tracked `.npmrc` during a session and no gate noticed. It was one `git add -A` from
 * being published. The gap was simply that nothing looked for a secret — the diff
 * machinery was already adequate, since `parseDiff()` falls back to `git diff <base>`
 * when the tree is dirty and therefore does see uncommitted work.
 *
 * Two scans, because they cover different windows:
 *
 * 1. The diff — anything a change introduces, in any file type. This is the one that
 *    would have caught the incident above.
 * 2. The **working tree**, for credential-bearing config only. This covers what the
 *    diff cannot: a secret already present in `base`, or a run with an explicit
 *    `--head` where the diff is empty. Without it, a token committed to `main` would
 *    stay invisible forever, because no future diff adds it.
 *
 * Only tracked files are scanned. A gitignored `.env` is local by design and is not
 * this gate's business.
 */
function checkHardcodedSecrets() {
  const scanned = new Set();

  /**
   * Comment syntax is per-format, and getting this wrong silently disabled the whole
   * check on the one file type that matters most: in `.npmrc` a registry line *starts*
   * with `//` because the URL is protocol-relative —
   * `//npm.pkg.github.com/:_authToken=…` — so treating `//` as a comment skipped the
   * exact line the leak lives on. Its comment characters are `#` and `;`.
   */
  const isComment = (file, trimmed) => {
    if (CREDENTIAL_CONFIG.test(file) || file.endsWith('.npmrc')) {
      return trimmed.startsWith('#') || trimmed.startsWith(';');
    }
    return (
      trimmed.startsWith('#') ||
      trimmed.startsWith('//') ||
      trimmed.startsWith(';') ||
      trimmed.startsWith('*')
    );
  };

  const inspect = (file, lineNo, text, origin) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (isComment(file, trimmed)) {
      // A commented-out secret is still a secret, so only skip comments that carry
      // no credential-shaped literal.
      if (!SECRET_PATTERNS.some((p) => p.re.test(text))) return;
    }
    for (const { name, re } of SECRET_PATTERNS) {
      if (re.test(text)) {
        fail(
          `${file}:${lineNo} contains what looks like a ${name} (${origin}). ` +
            `Credentials come from the environment only — use \${ENV_VAR}. Rotate it: it is in your shell history and reflog.`,
        );
        return;
      }
    }
    const assignment = SECRET_ASSIGNMENT.exec(trimmed);
    if (assignment && !isIndirect(assignment[2])) {
      fail(
        `${file}:${lineNo} sets ${assignment[1]} to a literal value (${origin}). ` +
          `Use a \${ENV_VAR} reference so the value never lands in a file.`,
      );
    }
  };

  // 1. Everything added in the diff, any file type.
  for (const [file, lines] of addedLinesByFile) {
    // This file necessarily contains the patterns it looks for.
    if (file === 'scripts/review-guardrails.mjs') continue;
    for (const { line, text } of lines) inspect(file, line, text, 'added in this diff');
  }

  // 2. Credential config in the working tree, committed or not.
  let tracked = [];
  try {
    tracked = git(['ls-files']).split('\n').filter(Boolean);
  } catch {
    return;
  }
  for (const file of tracked) {
    if (!CREDENTIAL_CONFIG.test(file)) continue;
    if (!fileExists(file)) continue;
    if (scanned.has(file)) continue;
    scanned.add(file);
    const lines = read(file).split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      inspect(file, i + 1, lines[i], 'working tree, tracked credential config');
    }
  }
}

/**
 * Every asset glob in the base build options must also be in the `development` configuration.
 *
 * Angular **replaces** a configuration's `assets` array; it does not merge it with the base
 * one. That cost this programme a full debugging session: only the base array carried
 * adf-core's translation glob, so every dev server ever started on this branch 404ed the
 * catalogue while the production build shipped it correctly. The symptom — one accessibility
 * label rendering as a raw key — was diagnosed as a stale dev server needing a restart, which
 * could never have fixed it.
 *
 * The `development` config is allowed *extra* entries; it may not be missing any.
 */
function checkAngularDevAssets() {
  const file = 'angular.json';
  if (!fileExists(file)) return;

  /** @type {any} */
  let doc;
  try {
    doc = JSON.parse(read(file));
  } catch (error) {
    fail(`${file} is not valid JSON: ${error instanceof Error ? error.message : error}`);
    return;
  }

  for (const [projectName, project] of Object.entries(doc.projects ?? {})) {
    const targets = /** @type {any} */ (project).targets ?? /** @type {any} */ (project).architect;
    for (const [targetName, target] of Object.entries(targets ?? {})) {
      const base = /** @type {any} */ (target).options?.assets;
      if (!Array.isArray(base)) continue;
      // `ignore` is part of the identity, not decoration. Compared on glob/input/output alone,
      // an entry that excludes a file in the base array and not in `development` reads as
      // identical while the two configurations serve different files — which is the same class
      // of divergence this whole check exists for, one field further in.
      const key = (entry) =>
        typeof entry === 'string'
          ? entry
          : [
              entry.glob,
              entry.input,
              entry.output ?? '',
              [...(entry.ignore ?? [])].sort().join(','),
            ].join('|');

      for (const [configName, config] of Object.entries(
        /** @type {any} */ (target).configurations ?? {},
      )) {
        const override = /** @type {any} */ (config).assets;
        if (!Array.isArray(override)) continue; // inherits the base array; nothing to diverge
        const present = new Set(override.map(key));
        for (const entry of base) {
          if (present.has(key(entry))) continue;
          fail(
            `${file}: ${projectName}:${targetName} configuration "${configName}" overrides ` +
              `assets but omits ${JSON.stringify(entry)}. Angular replaces the array rather ` +
              'than merging it, so this asset is served by the base config and 404s here.',
          );
        }
      }
    }
  }
}

/**
 * Every adf-hx marker in the codebase must have a row in `docs/adf-hx-workarounds.md`, and every
 * row naming a code site must have its marker there.
 *
 * The register exists so the cost of adopting adf-hx is countable. A markdown list with no gate
 * decays the moment someone adds a thirteenth workaround and forgets the row — the programme has
 * three gates that exist for exactly that reason, so this one does too.
 *
 * Checked in both directions, because they catch different decay:
 *
 * - **marker with no row** — a workaround was added and never registered. The common case.
 * - **row with no marker** — a workaround was removed, or the row points at the wrong file, so the
 *   register overstates what the code does. Rows whose site is a `.json` file are exempt: JSON
 *   cannot carry a comment, and `— (config)` in the row declares that.
 * - **marker kind disagreeing with its ID** — `MISSING(adf-hx): W3` is a mislabelled category, and
 *   the categories have different audiences, so the mislabel matters.
 */
function checkAdfHxWorkaroundIds() {
  const register = 'docs/adf-hx-workarounds.md';
  if (!fileExists(register)) {
    fail(`${register} does not exist, but the adf-hx marker gate depends on it.`);
    return;
  }

  const KIND_BY_LETTER = {
    W: 'WORKAROUND(adf-hx)',
    M: 'MISSING(adf-hx)',
    R: 'REFUSES',
    D: 'DEGRADED(adf-hx)',
  };
  const MARKER =
    /(WORKAROUND\(adf-hx\)|MISSING\(adf-hx\)|REFUSES|DEGRADED\(adf-hx\)):\s*([WMRD]\d+)/g;

  // ---- the register's rows ----
  /** @type {Map<string, { configOnly: boolean, line: number }>} */
  const rows = new Map();
  const registerLines = read(register).split('\n');
  registerLines.forEach((text, index) => {
    // A table row whose first cell is an id: `| W1  | … |`
    const match = /^\|\s*([WMRD]\d+)\s*\|/.exec(text);
    if (!match) return;
    const id = match[1];
    if (rows.has(id)) {
      fail(`${register}:${index + 1} declares ${id} twice. An id must identify one row.`);
      return;
    }
    // Two documented exemptions from the "must have a marker" rule:
    //   `(config)` — the site is a `.json` file, which cannot hold a comment.
    //   `(fixed`   — the workaround is gone. The register keeps the row on purpose, because the
    //                history of what adf-hx cost is the point of the file, but there is no longer
    //                a marker to find.
    rows.set(id, {
      configOnly: text.includes('(config)') || text.includes('(fixed'),
      line: index + 1,
    });
  });

  if (rows.size === 0) {
    fail(`${register} has no id rows, so the marker gate cannot verify anything.`);
    return;
  }

  // ---- the codebase's markers ----
  /** @type {Map<string, string[]>} */
  const markerSites = new Map();
  // `--others --exclude-standard` as well as tracked, because a workaround introduced in a
  // **new** file is invisible to `ls-files` alone. That gap surfaced the first time this gate ran
  // against a new pager component: the row was flagged as having no marker while the marker was
  // sitting in an untracked file. Gitignored files stay excluded — they are not the codebase.
  const sources = git(['ls-files', '--cached', '--others', '--exclude-standard'])
    .split('\n')
    .filter(Boolean)
    // The register and the findings document quote marker names as documentation, and the gate's
    // own source contains the pattern. Scanning them would make the gate assert about itself.
    .filter((file) => !file.startsWith('docs/') && file !== 'scripts/review-guardrails.mjs')
    .filter((file) => /\.(ts|mts|mjs|js|html|scss)$/.test(file));

  for (const file of sources) {
    if (!fileExists(file)) continue;
    const body = read(file);
    for (const found of body.matchAll(MARKER)) {
      const [, kind, id] = found;
      const expected = KIND_BY_LETTER[id[0]];
      if (kind !== expected) {
        fail(
          `${file} marks ${id} as \`${kind}:\` but its id belongs to category ${id[0]}, whose ` +
            `marker is \`${expected}:\`. The categories have different audiences.`,
        );
      }
      if (!markerSites.has(id)) markerSites.set(id, []);
      markerSites.get(id).push(file);
    }
  }

  // ---- forward: every marker has a row ----
  for (const [id, sites] of markerSites) {
    if (rows.has(id)) continue;
    fail(
      `${sites[0]} carries marker ${id}, which has no row in ${register}. Add the row, or use an ` +
        'existing id if this is another site for the same workaround.',
    );
  }

  // ---- reverse: every non-config row has a marker ----
  for (const [id, row] of rows) {
    if (row.configOnly || markerSites.has(id)) continue;
    fail(
      `${register}:${row.line} declares ${id} but no source file carries that marker. Either the ` +
        'workaround is gone — strike the row through rather than deleting it — or the row names ' +
        'the wrong site.',
    );
  }
}

/**
 * No `@alfresco/*` type may be reachable from a library's public barrel.
 *
 * `docs/adf-hx-beta-plan.md` sets this as a **hard rule** for Phase 3 — "adf-hx types must never
 * appear in our public API signatures, enforced by a lint or API-extractor gate" — and until now
 * only the convention existed. Nothing would have caught a leak.
 *
 * Two distinct harms, which is why the check is on *reachability from the barrel* rather than on
 * signatures alone:
 *
 * 1. **API leak.** An adf-hx type in our public surface makes every consumer depend on adf-hx's
 *    versioning, which is the opposite of what the four-layer contract promises.
 * 2. **Bundle boundary.** A barrel is one module. The moment anything it re-exports imports
 *    `@alfresco/*`, adf-core becomes reachable from the app shell and lands in the **initial**
 *    bundle — measured at 1.70 → 2.65 MB when that happened, which is why
 *    `libs/shared/adf-hx-bridge/src/providers.ts` exists as a separate entry point.
 *
 * The bridge's `providers.ts` is the secondary entry point for adf-hx-facing code. Most consumers
 * are lazy (the POC route); the shell nav drawer and `app.config.ts` also import it eagerly on
 * purpose — see the allowlist below — so the gate watches the main barrel, not "never import
 * providers at startup".
 */
function checkNoAdfHxInPublicApi() {
  // Scoped to the two heavy packages, deliberately. `@alfresco/adf-extensions` is also an
  // `@alfresco` scope, but it is a small library that leaks no type and moves no bundle, and since
  // NXSAT-308 nothing in `libs/` imports it at all: `libs/shared/extensions` owns the three
  // functions it used to import. It remains installed only because adf-core and adf-hx need it.
  const ALFRESCO = /from\s+['"]@alfresco\/(adf-hx-content-services|adf-core)/;

  /**
   * Known, deliberate exceptions — each with the reason, because an allowlist without one becomes
   * a dumping ground.
   */
  const ALLOWED = new Map([
    [
      'libs/shared/adf-hx-bridge/src/lib/ui/hxp-browse-nav-drawer/hxp-browse-nav-drawer.component.ts',
      "The app shell's nav drawer renders adf-hx's document tree, so the shell genuinely needs " +
        'adf-hx eagerly. This is a product decision, not a barrel accident, and it means the eager ' +
        'bundle has TWO causes — this and CONTEXT_MENU_ACTIONS_PROVIDERS in app.config.ts. Removing ' +
        'it requires deferring the tree behind an outlet, which is Phase 4 work.',
    ],
  ]);
  const barrels = git(['ls-files', '--cached', '--others', '--exclude-standard'])
    .split('\n')
    .filter((file) => /^libs\/.+\/src\/index\.ts$/.test(file));

  if (barrels.length === 0) {
    fail('No library barrels found, so the adf-hx public-API gate cannot verify anything.');
    return;
  }

  for (const barrel of barrels) {
    if (!fileExists(barrel)) continue;
    const seen = new Set();
    /** @type {{ file: string, from: string[] }[]} */
    const offenders = [];

    // Walk the barrel's re-export graph. Depth matters: the leak that cost 0.95 MB of initial
    // bundle was two hops away — the barrel exported a providers file which imported adf-hx.
    const queue = [{ file: barrel, path: [barrel] }];
    while (queue.length > 0) {
      const { file, path } = queue.shift();
      if (seen.has(file)) continue;
      seen.add(file);
      if (!fileExists(file)) continue;
      const body = read(file);

      if (ALFRESCO.test(body) && file !== barrel) {
        offenders.push({ file, from: path });
        continue; // one report per reachable file is enough
      }

      for (const match of body.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
        const target = join(dirname(file), match[1]);
        const rel = relative(repoRoot, join(repoRoot, target));
        for (const candidate of [`${rel}.ts`, join(rel, 'index.ts')]) {
          if (fileExists(candidate) && !seen.has(candidate)) {
            queue.push({ file: candidate, path: [...path, candidate] });
          }
        }
      }
    }

    for (const offender of offenders) {
      const offenderPath = offender.file.replace(/\\/g, '/');
      if (ALLOWED.has(offender.file) || ALLOWED.has(offenderPath)) continue;
      fail(
        `${offender.file} imports from \`@alfresco/*\` and is reachable from the public barrel ` +
          `${barrel} via ${offender.from.slice(1).join(' -> ') || 'a direct export'}. That both ` +
          'leaks an adf-hx type into our public API and makes adf-core reachable from anything ' +
          'importing the barrel, which puts it in the initial bundle. Move it behind a secondary ' +
          'entry point, as `libs/shared/adf-hx-bridge/src/providers.ts` does.',
      );
    }
  }
}

/**
 * A hard-coded user-facing string in any template.
 *
 * ## Repo-wide, over every template in `apps/` and `libs/`
 *
 * It started diff-scoped, because the application then held roughly 1,150 hard-coded strings
 * across thirteen projects and a repo-wide check would have been red on arrival. Diff scope has
 * a cost this file already records for `checkBlobUrlLifecycle`: every pre-existing violation is
 * exempt forever, and a string that moves between files in a refactor reads as unchanged. Once
 * the extraction was done it went repo-wide (slice 12 of `docs/i18n-full-extraction-plan.md`),
 * so it now measures the tree rather than only stopping new additions. The exemptions are listed
 * in `EXEMPT` below, each with its reason.
 *
 * ## The heuristic, and why it is narrow
 *
 * Only text that looks like a sentence a user reads — it starts with a capital letter and carries
 * at least two letters. That excludes the things that are not prose but live in the same
 * position: `<mat-icon>search</mat-icon>` ligature names, CSS values, numbers and single
 * characters are all lowercase or too short.
 *
 * There is no suppression comment, on purpose. The remedy for a false positive is to route the
 * string through the translate pipe, and doing that to a string that did not strictly need it
 * costs one catalogue entry and is never wrong. A suppression marker would be the cheaper path
 * and would become the default one.
 */
function checkNoHardcodedUiText() {
  /** Attributes whose literal value is read or announced to a user. */
  const TEXT_ATTRIBUTES = /\b(placeholder|matTooltip|alt|aria-label|title)="([^"<>{}]*)"/g;
  /** Element text on the same line as its tags: `>Some text<`. */
  const ELEMENT_TEXT = />([^<>{}]*)</g;
  /**
   * A line that is nothing but words — no tag, no binding, no interpolation, no pipe.
   *
   * Deliberately strict. A trailing comma means a TypeScript fragment rather than markup, and
   * any of `<>{}="|` means the line is carrying syntax and one of the other two patterns owns
   * it. That leaves genuine prose, which is the only thing this is meant to find.
   */
  const BARE_PROSE_LINE = /^[^<>{}="|]+$/;
  /**
   * The same attributes written as a BINDING carrying a literal: `[title]="'Recently Edited'"`.
   *
   * Angular resolves that to the same DOM attribute as the plain form, so it is the same defect —
   * but `TEXT_ATTRIBUTES` cannot see it, because the brackets are part of the attribute name and
   * the braces exclusion never applies.
   */
  const BOUND_TEXT_ATTRIBUTES =
    /\[(?:attr\.)?(placeholder|matTooltip|alt|aria-label|title)\]="\s*('[^']*'|"[^"]*")\s*"/g;

  /** Prose a user reads, as opposed to an icon ligature, a CSS value or a number. */
  function isDisplayText(value) {
    // A BOUND literal keeps its inner quotes: `[title]="'Recently Edited'"` captures
    // `'Recently Edited'`, which starts with an apostrophe, so the capital-letter test below
    // rejected it and the string passed.
    const text = value
      .trim()
      .replace(/^(['"])(.*)\1$/, '$2')
      .trim();
    if (text.length < 2) return false;
    if (!/^[A-Z]/.test(text)) return false;
    return (text.match(/[A-Za-z]/g) ?? []).length >= 2;
  }

  /**
   * Whether a line with its interpolations blanked still carries English prose, and which part.
   *
   * Deliberately NOT `isDisplayText`. That requires an initial capital to keep CSS values and
   * identifiers out, and a sentence continuation after an interpolated value is lowercase — so the
   * capital rule excluded the exact shape wanted here. This instead asks whether a fragment reads
   * like words: at least three letters, and either two words or a word of three or more letters.
   *
   * Units and technical tokens are listed rather than inferred. `px`, `KB` and `UTC` appear beside
   * a bound number in a template and are not translatable prose; a heuristic that tried to
   * recognise them by shape would either miss short English words like `of` — which IS prose, in
   * `Page 1 of 5` — or flag the units. A short explicit list is the honest way round that.
   */
  const NON_PROSE_TOKENS = new Set([
    'px',
    'em',
    'rem',
    'ms',
    'kb',
    'mb',
    'gb',
    'tb',
    'utc',
    'id',
    'uid',
    'url',
    'http',
    'https',
    'nxql',
    'pdf',
    'csv',
    'json',
    'api',
    'ai',
    'ok',
    'fps',
    'dpi',
    'rgb',
  ]);

  function proseFragmentBesideValue(blanked) {
    const candidates = blanked
      // Complete tags first, then the two PARTIAL ones Prettier leaves when it splits an element
      // across lines: a tag opened at the end of this line, and the tail of one opened on the
      // previous line. Without these, `{{ x }}</span` yielded the fragment `/span`.
      .replace(/<[^>]*>/g, '\u0000')
      .replace(/<[^<>]*$/g, '\u0000')
      .replace(/^[^<>]*>/g, '\u0000')
      .split('\u0000')
      // `matTooltip="Download` is a mixed attribute value, not a fragment called `matTooltip=...`.
      // Naming the attribute in the report made a real finding look like a parser artefact.
      .map((part) => part.replace(/^[\w.[\]-]+="/, '').trim())
      .map((part) => part.trim())
      .filter(Boolean);

    for (const candidate of candidates) {
      // Judge the words, but REPORT the fragment as written. Normalising punctuation away before
      // reporting turned `event(s)` into `event s`, which reads like a parser bug rather than the
      // untranslatable plural suffix it actually is.
      const words = candidate.match(/[A-Za-z][A-Za-z'\u2019-]*/g) ?? [];
      if (words.length === 0) continue;
      if ((candidate.match(/[A-Za-z]/g) ?? []).length < 3) continue;
      if (words.every((word) => NON_PROSE_TOKENS.has(word.toLowerCase()))) continue;
      // A tag remnant that survived the strips above is not prose.
      if (/^\//.test(candidate)) continue;
      if (words.length < 2 && !words.some((word) => word.length >= 3)) continue;
      return candidate;
    }
    return null;
  }

  /**
   * Whether a text-bearing attribute's value is text a user reads.
   *
   * No initial-capital rule: the attribute name has already established that the value is prose, so
   * the only question left is whether it is words rather than a token. A date mask like
   * `mm/dd/yyyy` IS words for this purpose — it tells the user what format to type and differs by
   * locale, which is precisely why it must be translatable.
   */
  function isAttributeText(value) {
    const text = value
      .trim()
      .replace(/^(['"])(.*)\1$/, '$2')
      .trim();
    if (text.length < 2) return false;
    // A binding expression or an interpolation is handled by the other branches.
    if (/[{}]/.test(text)) return false;
    // A repository path or a URL is STRUCTURE, not prose: `/default-domain/workspaces/MyWorkspace`
    // tells the user the shape of a path, and translating a path segment would make the example
    // wrong. Excluded by shape rather than by a capital letter, which is the distinction this
    // predicate exists to draw.
    if (/^(?:\/|[a-z]+:\/\/)/.test(text)) return false;
    return (text.match(/[A-Za-z]/g) ?? []).length >= 2;
  }

  /**
   * Templates exempt from the repo-wide sweep, and why each one is.
   *
   * `apps/nuxeo-satori-template` is the customer starter template and its 122 strings are
   * deferred by an explicit decision, not an oversight. `libs/extensions/acme-extensions` is
   * the worked example of a customer extension — its strings are a customer's to translate,
   * and keying them would teach the opposite lesson. `libs/core` is Nx scaffolding that
   * renders nowhere.
   *
   * Nothing shippable is on this list, and adding to it should be harder than fixing the
   * string.
   */
  const EXEMPT = [
    /^apps\/nuxeo-satori-template\//,
    /^libs\/extensions\/acme-extensions\//,
    /^libs\/core\//,
    // A standalone debug page, not referenced by `angular.json` and not copied as an asset, so
    // it is never served to anyone.
    /^apps\/nuxeo-ui\/src\/diagnostic\.html$/,
    // Spec fixtures are NOT exempted by suffix here. `provenTestOnlyFixtures()` below decides
    // them one file at a time, by checking the property the suffix used to assume.
    // The document shell. `checkNoTemplateSyntaxInDocumentShell` REQUIRES its title to be a
    // literal — Angular never compiles this file, so a pipe there renders as visible braces.
    // Without this exemption the two gates contradict each other and one of them has to be
    // wrong. The title is replaced at runtime from Layer 0 `branding.documentTitle`.
    /(^|\/)src\/index\.html$/,
  ];

  /**
   * Fixture templates whose test-only status is PROVEN, not assumed from the filename.
   *
   * `/\.host\.html$/` and `/\.spec\.html$/` used to sit in `EXEMPT` as suffix patterns, which
   * admitted every future file with those names rather than the ones anyone had looked at. That
   * is not a hypothetical cost: the `.spec.html` entry was justified against two named,
   * hand-verified fixtures, and by the time it was reviewed there were FOUR `.spec.html` files.
   * `dashboard-ai-banner-contrast.spec.html` and `header-settings-focus-ring.spec.html` had let
   * themselves in, and nothing reported it. A blanket rule cannot distinguish the file someone
   * checked from the file that merely shares its ending.
   *
   * So the properties the suffix was standing in for are checked per file, and the check
   * FAILS CLOSED — an unproven fixture is held to the same standard as any shipped template:
   *
   *   1. exactly one `*.spec.ts` REFERENCES it — by a path that resolves to this exact file,
   *      so it is a fixture rather than shared markup;
   *   2. NO non-spec source references or even names it, so no shipped component compiles it;
   *   3. it lies under no `assets` input directory and is named by no build config.
   *
   * Only then is its text test DATA — markup chosen to reproduce a rendering bug, where keying
   * the strings would make the fixture describe something other than the case under test.
   *
   * (2) and the directory half of (3) close two holes review found in the first version of this
   * function, which compared basenames and nothing else. A production component doing
   * `templateUrl: './thing.host.html'` was not a `.spec.ts` and not a config, so it did not
   * count against the fixture at all — a shipped template could hold the proof of its own
   * exemption. And an `assets` entry of `{ "glob": "**\/*", "input": "…" }` serves a whole
   * directory without ever writing a basename; every asset entry in this repository is of
   * exactly that form, so the basename scan could not have detected any of them. Both are
   * checked structurally now rather than textually.
   *
   * ## Round three: (1) is a reference, not a name anywhere
   *
   * Fixing (2) left (1) still matching a basename against whole file bodies, which is not the
   * property it claims. `a/x.host.html` and `b/x.host.html` both saw the single spec that
   * referenced only `a/`, so `b/` — named by nobody — was exempted on the strength of `a/`'s
   * proof. A quoted `.html` path is now resolved against the referring file's own directory and
   * compared to the walked path by equality, so a reference proves the file it points at.
   *
   * ## Round four: a reference is a `templateUrl`, and `..` cannot leave the tree
   *
   * Round three left two ways to be exempted without being hosted. Any quoted `.html` literal
   * in executable code counted, so an unused `const ref = './widget.host.html'` was proof;
   * and `resolveRef` popped on `..` without checking, so a path climbing above the repository
   * root was clamped back onto an in-repo file and proved that file instead. Both reported on
   * the pull request. A traversal that underflows now resolves to nothing at all, and a
   * reference is the `templateUrl` of an object literal decorating a class with `Component`
   * **imported from `@angular/core`**. Review caught three weaker versions of that on the way,
   * each an accepted proof that hosts nothing: any property called `templateUrl`, which a
   * decoy object literal satisfies; then any call spelled `Component`, which a naked statement
   * satisfies; then any decorator of that name, which a locally declared one satisfies.
   *
   * **What this still does not prove.** A `templateUrl` assembled by concatenation resolves to
   * nothing. On the spec side that is fail-closed and needs no fallback — no resolved
   * reference means no proof, so the fixture is scanned like any template. On the non-spec
   * side it would be fail-OPEN, so the blunt basename mention is kept there deliberately. The
   * consequence is asymmetric on purpose:
   * a production file mentioning `x.host.html` anywhere, even in a comment, blocks every
   * same-named fixture in the repository. That is a false rejection, whose cost is that a
   * fixture gets held to the shipped-template standard — the safe direction, and the direction
   * this check has had to be corrected toward twice.
   *
   * Adding a fixture is still easy; adding one that is *served* no longer silently disables the
   * guard for it.
   */
  const provenFixtures = (() => {
    const isFixtureName = (path) => /\.(?:host|spec)\.html$/.test(path);
    const fixtures = [...walk('apps', isFixtureName), ...walk('libs', isFixtureName)];
    if (fixtures.length === 0) return new Set();

    /**
     * `./thing.host.html` in `a/b/c.spec.ts` -> `a/b/thing.host.html`, or `null`.
     *
     * Repo-relative and normalised, so a reference can be compared to a walked path by
     * equality rather than by basename.
     *
     * `null` when the traversal climbs above the repository root, and that is the whole reason
     * this returns a nullable rather than a string. The loop used to `pop()` unconditionally,
     * and `pop()` on an empty array is a no-op — so a surplus `..` simply vanished and a path
     * that really resolves outside the checkout was clamped back onto an in-repo file, whose
     * exemption it then proved. The comment here claimed such a reference "simply matches no
     * fixture", which is the fail-closed contract the code did not keep. Reported on the pull
     * request; controlled in the selftest by a spec seven `..` deep.
     */
    const resolveRef = (fromFile, ref) => {
      const base = fromFile.slice(0, fromFile.lastIndexOf('/'));
      const out = [];
      for (const segment of `${base}/${ref}`.split('/')) {
        if (segment === '' || segment === '.') continue;
        if (segment === '..') {
          if (out.length === 0) return null;
          out.pop();
          continue;
        }
        out.push(segment);
      }
      return out.length === 0 ? null : out.join('/');
    };

    /**
     * Every `.html` path a source file **hosts as a template**, resolved against its own
     * directory.
     *
     * Parsed, not scanned. The first cut of this matched quoted paths in the raw text, which
     * review found exempts a fixture nobody hosts on the strength of a comment:
     * `// See './widget.host.html'` read as a reference, and the control written alongside it
     * used an UNQUOTED name so it did not catch the case. A comment is not part of the AST, so
     * taking references from the tree rules that out structurally rather than by another
     * pattern — which is the same reason the assertion audit stopped enumerating spellings of
     * `true`.
     *
     * Parsing alone was not enough either, and neither was the first narrowing. Any quoted
     * `.html` literal in executable code counted, used or not, so an unused
     * `const ref = './widget.host.html'` exempted a template nobody serves. Restricting that
     * to a `templateUrl` property left the same hole one layer in, because `templateUrl` is
     * only a property name: a decoy `const proof = { templateUrl: './widget.host.html' }`
     * hosts nothing and still counted. Both reported on the pull request.
     *
     * A reference is therefore the `templateUrl` of the object literal passed to a
     * `@Component(...)` **decorator whose name is bound to `@angular/core`**, which is the
     * only position where the property means "this file is my template" — and the same
     * position the non-spec rule below is looking for in production code. Each weaker version
     * of that was reported in turn: the call matched by callee name accepts a naked
     * `Component({ ... })` statement that decorates nothing, and the decorator matched by
     * spelling accepts one a file declared for itself.
     *
     * **Boundary.** A `templateUrl` assembled by concatenation is not a literal, and component
     * metadata spread in from a variable is not an object literal here; both resolve to
     * nothing. On the spec side that is fail-closed and needs no fallback — no resolved
     * reference means no proof, so the fixture is scanned like any template. On the non-spec
     * side it would be fail-OPEN, which is why the blunt textual basename fallback is kept
     * there deliberately.
     */
    const htmlRefs = (path, body) => {
      const refs = new Set();
      const source = ts.createSourceFile(
        path,
        body,
        ts.ScriptTarget.Latest,
        false,
        ts.ScriptKind.TS,
      );

      /**
       * The local names this file binds to `Component` from `@angular/core`.
       *
       * Usually the set `{'Component'}`, empty in a file that imports no such thing, and the
       * alias in `import { Component as NgComponent }`. Resolving the binding rather than
       * trusting the spelling is what stops a file declaring its own decorator called
       * `Component` — which Angular never compiles — from exempting a fixture. Review caught
       * that; it is the same defect as the decoy object literal, one level up again.
       *
       * The alias direction matters as much as the spoof: without it, renaming the import
       * would silently disable the exemption for a legitimately hosted fixture, so the
       * tightening would have introduced a false rejection while closing a false acceptance.
       * Both are controlled.
       */
      const componentBindings = new Set();
      for (const statement of source.statements) {
        if (!ts.isImportDeclaration(statement)) continue;
        if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
        if (statement.moduleSpecifier.text !== '@angular/core') continue;

        const bindings = statement.importClause?.namedBindings;
        if (!bindings || !ts.isNamedImports(bindings)) continue;
        for (const element of bindings.elements) {
          const imported = element.propertyName?.text ?? element.name.text;
          if (imported === 'Component') componentBindings.add(element.name.text);
        }
      }

      const isModuleLevelShadow = (identifier) => {
        const name = identifier.text;
        const useStart = identifier.getStart(source);
        for (const stmt of source.statements) {
          if (stmt.getStart(source) >= useStart) break;
          if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === name) return true;
          if (ts.isClassDeclaration(stmt) && stmt.name?.text === name) return true;
          if (ts.isVariableStatement(stmt)) {
            for (const decl of stmt.declarationList.declarations) {
              if (ts.isIdentifier(decl.name) && decl.name.text === name) return true;
            }
          }
        }
        return false;
      };

      const isImportedAngularComponent = (identifier) =>
        ts.isIdentifier(identifier) &&
        componentBindings.has(identifier.text) &&
        !isModuleLevelShadow(identifier);

      // The metadata of an `@angular/core` `@Component({ ... })` used as a DECORATOR, or null.
      //
      // Matching the call expression by callee name alone was the first attempt and review
      // caught it in the same round: a naked `Component({ templateUrl: './x.host.html' })`
      // statement decorates nothing and exempted the fixture anyway. Starting from the
      // `Decorator` node is what makes "this class's template" the thing being matched, rather
      // than any call that happens to be spelled `Component`.
      const componentMetadata = (node) => {
        if (componentBindings.size === 0) return null;
        if (!ts.isDecorator(node)) return null;
        const call = node.expression;

        return ts.isCallExpression(call) &&
          isImportedAngularComponent(call.expression) &&
          call.arguments.length > 0 &&
          ts.isObjectLiteralExpression(call.arguments[0])
          ? call.arguments[0]
          : null;
      };

      const visit = (node) => {
        const metadata = componentMetadata(node);
        for (const property of metadata ? metadata.properties : []) {
          if (!ts.isPropertyAssignment(property)) continue;
          if (!ts.isIdentifier(property.name) && !ts.isStringLiteral(property.name)) continue;
          if (property.name.text !== 'templateUrl') continue;

          const value = property.initializer;
          if (!ts.isStringLiteral(value) && !ts.isNoSubstitutionTemplateLiteral(value)) continue;
          if (!value.text.endsWith('.html')) continue;

          const resolved = resolveRef(path, value.text);
          if (resolved !== null) refs.add(resolved);
        }
        node.forEachChild(visit);
      };
      source.forEachChild(visit);
      return refs;
    };

    const sources = [
      ...walk('apps', (path) => path.endsWith('.ts')),
      ...walk('libs', (path) => path.endsWith('.ts')),
    ].map((path) => {
      const body = read(path);
      return {
        isSpec: /\.spec\.ts$/.test(path),
        body,
        // Parsing every `.ts` in the repository to find a handful of fixture references is
        // waste; a file with no `.html` anywhere in it cannot hold one.
        refs: body.includes('.html') ? htmlRefs(path, body) : new Set(),
      };
    });

    const configPaths = [
      ...walk('apps', (path) => /(?:^|\/)(?:project|angular)\.json$/.test(path)),
      ...walk('libs', (path) => /(?:^|\/)(?:project|angular)\.json$/.test(path)),
      ...(fileExists('angular.json') ? ['angular.json'] : []),
    ];
    const configBodies = configPaths.map(read);

    /**
     * Every directory a build copies wholesale, from any `{ glob, input }` asset entry.
     *
     * The glob itself is deliberately not interpreted: `**\/*` is the only form here, and
     * anything narrower is still a pattern this script would have to implement to rule out. The
     * directory is the part that decides, so a fixture inside a copied tree is unproven whatever
     * the glob says.
     */
    const assetInputs = [];
    for (const body of configBodies) {
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        // A config this script cannot parse cannot be cleared, so nothing is proven from it.
        return new Set();
      }
      const visit = (node) => {
        if (Array.isArray(node)) return node.forEach(visit);
        if (!node || typeof node !== 'object') return;
        if (typeof node.input === 'string' && typeof node.glob === 'string') {
          assetInputs.push(node.input.replace(/\/+$/, ''));
        }
        Object.values(node).forEach(visit);
      };
      visit(parsed);
    }

    const proven = new Set();
    for (const fixture of fixtures) {
      const name = fixture.slice(fixture.lastIndexOf('/') + 1);

      // Exactly one spec must reference THIS path. Resolved, not basename-matched: two
      // fixtures sharing a basename used to satisfy each other's proof, so the one no spec
      // named was exempted on the strength of the other's reference.
      if (sources.filter(({ isSpec, refs }) => isSpec && refs.has(fixture)).length !== 1) continue;

      // Nothing outside a spec may reference it — a shipped `templateUrl` pointing here means
      // the file is compiled into the product, so its text is not test data.
      if (sources.some(({ isSpec, refs }) => !isSpec && refs.has(fixture))) continue;

      // ...and a non-spec that merely MENTIONS the basename blocks it too, resolved or not.
      // That catches a basename quoted in prose or a static `templateUrl`, not concatenation:
      // `templateUrl: './widget' + '.host.html'` has no contiguous path for `htmlRefs` to
      // resolve and no basename mention either, so it is NOT proven here and remains scanned.
      // The trade is intentional — under-broad would ship a served template as a fixture.
      if (sources.some(({ isSpec, body }) => !isSpec && body.includes(name))) continue;

      if (configBodies.some((body) => body.includes(name))) continue;
      if (assetInputs.some((input) => input !== '' && fixture.startsWith(`${input}/`))) continue;
      proven.add(fixture);
    }
    return proven;
  })();

  /**
   * Every template, not only the changed ones.
   *
   * Diff scope was right while the application was full of hard-coded English: a repo-wide
   * check would have been red on day one and turned off by the end of the week. It is now
   * within six strings of clean, and diff scope has a cost — a string that moves between files
   * in a refactor reads as unchanged, and anything that pre-dates the check is invisible
   * forever. `docs/i18n-full-extraction-plan.md` calls this slice 12.
   */
  const templates = [
    ...walk('apps', (path) => path.endsWith('.html')),
    ...walk('libs', (path) => path.endsWith('.html')),
  ].filter((path) => !EXEMPT.some((pattern) => pattern.test(path)) && !provenFixtures.has(path));

  if (templates.length === 0) {
    fail('No templates were found under apps/ or libs/, so this gate asserted nothing.');
    return;
  }

  const everyLine = templates.map((file) => [
    file,
    read(file)
      .split('\n')
      .map((text, index) => ({ line: index + 1, text })),
  ]);

  /**
   * The file's lines with comment and `<pre>` spans blanked out, keyed by line number.
   *
   * ## Why comments are excluded at all
   *
   * The skip here was `trimmed.startsWith('<!--')`, which only recognises a comment's FIRST line
   * — so the body of one was scanned as markup. It fired on the nav drawer's own explanation of
   * why the tree name goes through an interpolation parameter. Text inside a comment renders to
   * nobody, so it cannot be a string a user reads.
   *
   * `<pre>` holds code samples shown to customers as documentation. `import { Component } from
   * '@angular/core'` is not prose, and translating it would be actively wrong.
   *
   * ## Why spans are blanked rather than whole lines skipped
   *
   * The first version of this skipped any line CONTAINING `<!--`, which exempted more than the
   * comment: `<p>Hello There</p> <!-- note -->` was skipped in full, so a hard-coded label
   * escaped the gate entirely by having a comment after it. That is a false negative in the check
   * that enforces AC1, and it is the same mistake the `| translate` handling below already
   * records having made — skipping the line exempted more than the thing that earned it.
   *
   * Blanking preserves line numbers and column positions, so what is left on the line is exactly
   * the markup, and the patterns above see it unchanged.
   */
  function blankSkippableSpans(body) {
    // Each opener lists EVERY terminator the HTML parser accepts, not just the common one.
    //
    // `-->` alone is wrong: the spec's comment-end-bang state makes `--!>` a valid terminator too,
    // so `<!-- note --!>Delete</div>` closes the comment and `Delete` is visible text. With one
    // terminator this function read the comment as unterminated and blanked to end of file —
    // taking every hard-coded string after it out of the gate's sight. CodeQL flagged the same
    // pattern in `extract.mjs`, where it only skips an extraction; here it silently disables the
    // check for the rest of the file, which is the worse direction.
    const OPENERS = [
      ['<!--', ['-->', '--!>']],
      ['<pre', ['</pre>']],
      // `<code>` holds identifiers shown to a developer — `ConfirmDialogComponent`,
      // `Nuxeo-Drive.DMG`. The extraction codemod keyed nine Angular class names on the contracts
      // page as translatable strings, which would have let a translator rename a class in the
      // documentation. Restoring them as literals then made this gate flag them as hard-coded
      // English, because it cannot tell an identifier from prose — so the element that marks
      // something as code is what excludes it, exactly as `<pre>` already does.
      ['<code', ['</code>']],
    ];
    const chars = [...body];
    let index = 0;
    while (index < chars.length) {
      const rest = body.slice(index);
      const opener = OPENERS.find(([open]) => rest.startsWith(open));
      if (!opener) {
        index += 1;
        continue;
      }
      const [, closers] = opener;
      // The EARLIEST terminator wins, so a `-->` later in the file cannot extend a span that
      // `--!>` already closed.
      let end = -1;
      let closeLength = 0;
      for (const close of closers) {
        const at = body.indexOf(close, index + 1);
        if (at !== -1 && (end === -1 || at < end)) {
          end = at;
          closeLength = close.length;
        }
      }
      // An unterminated comment or `<pre>` runs to end of file. Blanking to the end is the safe
      // reading: the rest of the file is inside it as far as a browser is concerned.
      const stop = end === -1 ? chars.length : end + closeLength;
      for (let at = index; at < stop; at += 1) {
        if (chars[at] !== '\n') chars[at] = ' ';
      }
      index = stop;
    }
    return new Map(
      chars
        .join('')
        .split('\n')
        .map((text, at) => [at + 1, text]),
    );
  }

  for (const [file, lines] of everyLine) {
    // Spans BLANKED, not lines skipped. Skipping any line containing `<!--` exempted more than
    // the comment: `<button title="Recently Edited"></button> <!-- note -->` was skipped whole, so
    // a real label escaped by having a comment after it. Blanking preserves line and column, so
    // what is left on the line is exactly the markup.
    const blanked = blankSkippableSpans(read(file));
    for (const { line } of lines) {
      const trimmed = (blanked.get(line) ?? '').trim();
      if (!trimmed) continue;

      // Everything already routing through the pipe is removed, and then what is LEFT is
      // examined.
      //
      // This used to `continue` on the whole line, so one translated expression exempted
      // everything beside it — `<button [attr.aria-label]="'x' | translate">Show details</button>`
      // was never looked at. Two of the three blind spots in this check were of that shape:
      // exempting more than the thing that earned the exemption.
      const remainder = trimmed
        .replace(/(?:\[[\w.$-]+\]|\([\w.$-]+\))="[^"]*\|\s*translate[^"]*"/g, '')
        .replace(/\{\{(?:[^{}]|\{[^{}]*\})*\|\s*translate(?:[^{}]|\{[^{}]*\})*\}\}/g, '');
      if (!remainder.trim() || remainder.includes('| translate')) continue;

      /** @type {{ what: string, value: string } | null} */
      let offence = null;

      for (const [, attribute, value] of remainder.matchAll(TEXT_ATTRIBUTES)) {
        // A TEXT attribute is judged on its own terms, not by `isDisplayText`.
        //
        // That predicate requires an initial capital, which is right where it has to separate prose
        // from CSS values and icon ligatures in text position. But `placeholder`, `matTooltip`,
        // `alt`, `aria-label` and `title` can only ever hold text a user reads — the attribute name
        // has already settled that — so the capital rule adds nothing and subtracts
        // `placeholder="e.g. All PDFs created last month"` and `placeholder="mm/dd/yyyy"`, which
        // are exactly the shapes that stayed English while this gate reported the sweep clean.
        if (!isAttributeText(value)) continue;
        offence = { what: `${attribute}="${value}"`, value };
        break;
      }
      if (!offence) {
        for (const [, value] of remainder.matchAll(ELEMENT_TEXT)) {
          if (!isDisplayText(value)) continue;
          offence = { what: `the text \`${value.trim()}\``, value };
          break;
        }
      }
      if (!offence) {
        for (const [, attribute, value] of remainder.matchAll(BOUND_TEXT_ATTRIBUTES)) {
          if (!isDisplayText(value)) continue;
          offence = { what: `[${attribute}]="${value}"`, value };
          break;
        }
      }
      // Prose alone on its own line, which `ELEMENT_TEXT` cannot see because it needs `>` and
      // `<` on the same line as the words.
      //
      // Prettier puts text on its own line whenever the element does not fit, and Angular
      // control flow does it always:
      //
      //     } @else {
      //       Create
      //     }
      //
      // 34 strings were sitting in that gap — the Save, Create, Publish and Delete button of
      // almost every dialog in the application, and the login button. The check was written to
      // catch exactly those and reported the tree clean.
      // The REMAINDER, not `trimmed`: a line mixing a translated interpolation with hard-coded
      // words contains `{`, which `BARE_PROSE_LINE` rejects, so those words were never judged.
      const bare = remainder.trim();
      if (!offence && BARE_PROSE_LINE.test(bare) && isDisplayText(bare)) {
        offence = { what: `the text \`${bare}\``, value: bare };
      }

      // Prose AROUND a dynamic interpolation — the mixed-language sentence.
      //
      // `remainder` only strips interpolations that are already TRANSLATED, so a line like
      //
      //     <p>Content for "{{ item | descriptorLabel }}" will appear here.</p>
      //     <strong>{{ workflowDisplayName(wf) }}</strong> workflow on this document.
      //
      // still contains braces. `ELEMENT_TEXT` needs `>` and `<` with no braces between them and
      // `BARE_PROSE_LINE` rejects `{` outright, so the English on either side of the value was
      // never judged. Blanking the dynamic span is what makes it visible.
      //
      // It needs its OWN prose predicate, and the reason is the interesting part. `isDisplayText`
      // requires an initial capital, which is right for its usual job — it keeps CSS values and
      // identifiers out — but the fragment AFTER an interpolated value is a sentence continuation
      // and therefore lowercase almost every time: `workflow on this document`, `in the left menu
      // for ad-hoc queries`. The capital rule hid precisely the half of the sentence this check
      // exists to find. `BARE_PROSE_LINE` also rejects `"`, which hid `Content for "`.
      //
      // The fix shape is always one parameterised key for the whole sentence: a translator handed
      // the fragments either side of a value cannot move the value, and in German or Japanese it
      // does not sit where English puts it. INFO-144 forbids this outright.
      if (!offence) {
        // Marked on `trimmed`, NOT on `remainder`, and that distinction is the whole bug this
        // replaces.
        //
        // `remainder` has already DELETED every translated interpolation (see above), so beside a
        // correctly keyed value there was no interpolation left to blank, no marker appeared, and
        // this branch never ran. The shape it therefore could not see is the worst one in the set:
        //
        //     <strong>{{ 'admin.nxql-search' | translate }}</strong> in the left menu for ad-hoc
        //
        // half the sentence keyed and half hard-coded, which INFO-144 forbids outright. I reported
        // that exact line as fixed when it was not, because the gate agreed with me.
        //
        // U+0000 cannot occur in a template, so it marks a boundary unambiguously and keeps the
        // words on either side from joining into one token.
        const blanked = trimmed
          // An icon element's text is a LIGATURE NAME — `refresh` renders as a glyph, not as the
          // word — so translating it replaces the icon with a missing character. The rest of this
          // check excludes those via `isDisplayText`'s initial-capital rule; this path does not use
          // that rule, so it has to exclude them by element instead.
          .replace(/<(mat-icon|hxp-icon|sat-icon)\b[^>]*>[^<]*<\/\1>/g, '\u0000')
          .replace(/\{\{[^{}]*\}\}/g, '\u0000');
        if (blanked.includes('\u0000')) {
          const fragment = proseFragmentBesideValue(blanked);
          if (fragment) {
            offence = {
              what: `the text \`${fragment}\` beside an interpolated value`,
              value: fragment,
              mixed: true,
            };
          }
        }
      }

      // Quoted literals inside an Angular EXPRESSION. `{{ isOverdue(t) ? 'Overdue' : 'Due' }}` is
      // displayed text whose braces defeat both `ELEMENT_TEXT` and `BARE_PROSE_LINE`.
      if (!offence) {
        // Interpolations, and bound attributes that DISPLAY text — not every bound attribute.
        //
        // The first version scanned any `[…]="…"`, which flagged `[attr.data-type]="'Folder'"`: a
        // discriminator no user reads. It passed review only because the control covering it was
        // vacuous under a diff-scoped sweep — the fixture file was in the baseline commit, so the
        // diff was empty and nothing was examined. 284's repo-wide sweep is what exposed it.
        const expressions = [
          ...remainder.matchAll(/\{\{([^{}]*)\}\}/g),
          ...remainder.matchAll(
            /\[(?:attr\.)?(?:placeholder|matTooltip|alt|aria-label|title)\]="([^"]*)"/g,
          ),
        ].map(([, body]) => body);
        for (const expression of expressions) {
          if (/\|\s*translate/.test(expression)) continue;
          for (const [, literal] of expression.matchAll(/'([^']*)'/g)) {
            if (!isDisplayText(literal)) continue;
            // A dotted lowercase token is a key or a filename, never a sentence.
            if (/^[a-z][\w-]*(\.[\w-]+)+$/.test(literal)) continue;
            // SCREAMING_SNAKE is a discriminator or an enum member, never displayed prose.
            if (/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/.test(literal)) continue;
            offence = { what: `the quoted literal \`'${literal}'\``, value: literal };
            break;
          }
          if (offence) break;
        }
      }
      if (!offence) continue;

      fail(
        `${file}:${line} introduces ${offence.what} as hard-coded English.\n` +
          "    Add a key to the owning project's `i18n/en.json` and bind it with the translate " +
          "pipe — `{{ 'browse.details.show' | translate }}` for text, " +
          '`[attr.aria-label]="\'…\' | translate"` for an accessible name.\n' +
          '    Add the translator context alongside it in `i18n/en.context.json`: INFO-144 ' +
          'requires every string to carry enough context to be translated without asking, and ' +
          'acronyms to be expanded.\n' +
          '    If the key names a control, it must also go in `en-fallback.ts` — see ' +
          '`checkAccessibleNameFallbacks`.',
      );
    }
  }
}

/**
 * A hard-coded user-facing string in a **descriptor**, not a template.
 *
 * ## The category the template guardrail structurally cannot see
 *
 * Nav entries, packaged actions, column definitions and drawer links are data, not markup:
 *
 *     { id: 'app.navbar.browse', label: 'Browse', icon: 'folder' }
 *
 * rendered as `{{ item.label }}`. `checkNoHardcodedUiText` looks at added lines in `.html` and
 * sees an interpolation, which is the shape it is asking for — so every one of these passes it,
 * and no amount of template extraction ever reaches them.
 *
 * They were also absent from the extraction estimate, which counted template literals only.
 * Measured when this check was written: **294** across sixteen projects, against roughly 1350
 * in templates. The single most visible text in the product — the left navigation — is in this
 * category, which is how a screenshot of the application in French came to show one French
 * string and an entirely English nav.
 *
 * ## Scope and the properties chosen
 *
 * Repo-wide, like the template check, with the same three exemptions. It was diff-scoped while
 * the backlog was large; going repo-wide surfaced 28 descriptors that predated it — the note
 * editor's toolbar labels and the four packaged theme names — which diff scope had certified by
 * never looking at them.
 *
 * `label`, `placeholder`, `ariaLabel` and `tooltip` only. These are unambiguously UI chrome in
 * every use in this repository. `title` and `description` are deliberately **excluded** despite
 * catching real strings, because they are also the names of Nuxeo document properties and of
 * schema documentation, so flagging them would mean judgement calls in review — and a check
 * that argues with you is a check that gets disabled.
 *
 * ## Fixing one
 *
 * A descriptor is Layer 1 data, so the fix is not to wrap it in a pipe at the definition. Put a
 * translation **key** in the descriptor and apply the pipe where it renders
 * (`{{ item.label | translate }}`). That keeps the descriptor addressable from a manifest and
 * makes the string translatable, which the current shape allows only one of.
 */
function checkNoHardcodedDescriptorText() {
  // `label: 'Browse'` and friends. Single-quoted only: this repo's formatter produces single
  // quotes, and a template literal usually means interpolation, which is not a fixed string.
  // `title` is NOT here, and that is a decision with a control behind it.
  //
  // Eight `MatDialog` call sites passed `title: 'Saved Search'` while translating the
  // `placeholder` beside it, so adding `title` looked like the obvious fix. It is not: `title`
  // names a Nuxeo document property and a schema field at least as often as it names UI chrome,
  // so flagging it globally means arguing with a reviewer on most hits, and a check that argues
  // gets switched off. The selftest asserts `title: 'Saved Search'` is not flagged, and that
  // control is what caught the attempt.
  //
  // The dialog titles were fixed at their call sites instead. What is still uncovered is stated
  // in docs/i18n-status.md rather than papered over with a gate that cannot hold.
  const DESCRIPTOR_TEXT = /\b(label|placeholder|ariaLabel|tooltip)\s*:\s*'([A-Z][^']*)'/g;

  // Same exemptions as the template sweep, for the same reasons: the starter template is deferred
  // by decision, the sample extension's strings are a customer's, and `libs/core` renders nowhere.
  const EXEMPT = [
    /^apps\/nuxeo-satori-template\//,
    /^libs\/extensions\/acme-extensions\//,
    /^libs\/core\//,
  ];

  // Stories as well as specs: a story's args are the sample input a component's documentation
  // shows, standing in for text a caller has already translated, and never render in the product.
  const sources = [
    ...walk('apps', (path) => /\.ts$/.test(path)),
    ...walk('libs', (path) => /\.ts$/.test(path)),
  ].filter(
    (path) => !/\.(spec|stories)\.ts$/.test(path) && !EXEMPT.some((pattern) => pattern.test(path)),
  );

  if (sources.length === 0) {
    fail('No TypeScript sources were found under apps/ or libs/, so this gate asserted nothing.');
    return;
  }

  for (const file of sources) {
    const lines = read(file)
      .split('\n')
      .map((text, index) => ({ line: index + 1, text }));

    // A `label` paired with a `labelKey` is the **fixed** shape, not a violation. The key is
    // what renders and the literal is the fallback, which is the whole point of the two-field
    // contract — see `NavItemDescriptor.labelKey`. Read from the file rather than the diff
    // because the two lines are separate additions and a line-at-a-time check cannot see the
    // pair.
    // Paired within the SAME object, not within a few lines of it.
    //
    // This was a `±3` line window, which borrows a neighbour's key: in a compact array an unkeyed
    // `{ label: 'Delete' }` two lines below a keyed object saw that object's `labelKey` and was
    // skipped, so the gate had a false negative on exactly the shape it exists to catch. The
    // window cannot tell "this descriptor has a key" from "some descriptor nearby does".
    //
    // The enclosing object is found by walking back to the innermost unmatched `{` and forward to
    // its match. Braces inside string literals are not tracked — a brace in a descriptor's text
    // would mis-scope this, which is a smaller and louder failure than borrowing a key, and no
    // descriptor in the repository has one.
    const source = read(file);
    const lineStarts = [0];
    for (let at = source.indexOf('\n'); at !== -1; at = source.indexOf('\n', at + 1)) {
      lineStarts.push(at + 1);
    }
    // Takes the PROPERTY as well as the line, because the walk has to start inside the object.
    //
    // Neither line boundary works. From the line START, a single-line descriptor's own `{` is
    // ahead of the cursor and gets skipped. From the line END, its `}` and `{` are balanced, so the
    // object reads as nested and the walk runs off the top of the file. Starting at the matched
    // property puts the cursor inside the braces, where the first unmatched `{` is the object's own.
    const pairedWithKey = (lineNumber, property) => {
      const lineStart = lineStarts[lineNumber - 1];
      if (lineStart === undefined) return false;
      const lineEnd = (lineStarts[lineNumber] ?? source.length + 1) - 1;
      const found = source.indexOf(`${property}:`, lineStart);
      if (found === -1 || found > lineEnd) return false;
      const offset = found;
      let depth = 0;
      let open = -1;
      for (let at = offset; at >= 0; at -= 1) {
        if (source[at] === '}') depth += 1;
        else if (source[at] === '{') {
          if (depth === 0) {
            open = at;
            break;
          }
          depth -= 1;
        }
      }
      if (open === -1) return false;
      depth = 0;
      let close = source.length;
      for (let at = open; at < source.length; at += 1) {
        if (source[at] === '{') depth += 1;
        else if (source[at] === '}') {
          depth -= 1;
          if (depth === 0) {
            close = at;
            break;
          }
        }
      }
      return /\blabelKey\s*:/.test(source.slice(open, close + 1));
    };

    for (const { line, text } of lines) {
      const trimmed = text.trim();
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
      for (const [, property, value] of trimmed.matchAll(DESCRIPTOR_TEXT)) {
        if ((value.match(/[A-Za-z]/g) ?? []).length < 2) continue;
        if (pairedWithKey(line, property)) continue;
        fail(
          `${file}:${line} carries \`${property}: '${value}'\` — a user-facing string in a ` +
            'descriptor.\n' +
            '    Templates are not the only place these live, and the translate pipe cannot ' +
            'reach a descriptor. Put a key here and apply the pipe where it renders:\n' +
            `      { …, ${property}: 'nav.browse' }   →   {{ item.${property} | translate }}\n` +
            '    That keeps the descriptor manifest-addressable and makes the string ' +
            'translatable; the literal form allows only the first.',
        );
        break; // one report per line is enough
      }
    }
  }
}

/**
 * Our own translation catalogues: valid JSON, no blank values, and the same keys in every locale.
 *
 * ## Why each check is here
 *
 * **Parseable.** A catalogue with a trailing comma is not a style problem here — the Crowdin sync
 * rejects the file, so a malformed catalogue breaks the localization pipeline rather than the
 * build. `npm run build` never reads these; they are fetched at runtime. So nothing else in the
 * toolchain parses them.
 *
 * **No blank values.** An empty string is how the most widespread accessibility violation in this
 * product happened: `sat.platform-nav.expand` was deliberately blanked to suppress a duplicate
 * tooltip, and because upstream binds one key to both the tooltip and the accessible name, every
 * nav toggle rendered `aria-label=""` — axe `button-name`, critical, on seven of seven surfaces.
 * It stood for weeks, because an empty accessible name is invisible to anyone not using a screen
 * reader. A blank value is never what was meant; use a real string or remove the key.
 *
 * **Key parity.** A Crowdin pull that drops or renames a key leaves a locale silently falling
 * through to the reference language for that string. Comparing each locale's flattened key set
 * against `en.json` makes that a build failure rather than a bug report from a French customer.
 *
 * ## Scope
 *
 * `apps/` and `libs/` only. `node_modules` holds **48** upstream catalogues at exactly the same
 * relative shape — `.../i18n/en.json` from adf-core, both adf-hx bundles and satori-ui — and they
 * are not ours to validate. `walk()` prunes `node_modules` and `dist` already; the directory
 * roots keep it honest even if that changes.
 *
 * Parity needs two locales to assert anything, and for most of this repository's life there has
 * been one. That is not a silent pass: the count of comparisons is reported when it is zero, and
 * `review-guardrails.selftest.mjs` exercises parity against fixtures regardless of what the
 * repository currently ships.
 */
/**
 * `zz` is the generated pseudo-locale, not a shipped one.
 *
 * `tools/i18n/pseudo-locale.mjs` derives it from `en.json` on demand and `.gitignore` keeps it
 * out of the tree; it exists only while someone is auditing for strings no catalogue supplies.
 * Every locale check would otherwise treat it as a customer-facing language — demanding key
 * parity with a file that is regenerated from `en.json` anyway, and demanding Angular locale
 * data for a locale Angular has never heard of.
 */
const GENERATED_LOCALES = new Set(['zz']);
const isGeneratedLocale = (path) =>
  GENERATED_LOCALES.has(/(^|\/)i18n\/([a-z]{2}(?:-[A-Za-z]{2,4})?)\.json$/.exec(path)?.[2] ?? '');

function checkTranslationCatalogues() {
  const isCatalogue = (path) =>
    /(^|\/)i18n\/[a-z]{2}(-[A-Za-z]{2,4})?\.json$/.test(path) && !isGeneratedLocale(path);
  const catalogues = [...walk('apps', isCatalogue), ...walk('libs', isCatalogue)];

  if (catalogues.length === 0) {
    fail(
      'No translation catalogues were found under apps/ or libs/, so this gate asserted nothing. ' +
        'Check the `i18n/<locale>.json` glob before trusting a pass.',
    );
    return;
  }

  /** Flattens to dotted keys, mirroring `flattenCatalogue` in `app-translate-loader.ts`. */
  function flatten(value, prefix, out, onInvalid) {
    for (const [key, entry] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (typeof entry === 'string') out.set(path, entry);
      else if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        flatten(entry, path, out, onInvalid);
      } else {
        onInvalid(path, entry);
      }
    }
    return out;
  }

  /** @type {Map<string, Map<string, string>>} */
  const parsed = new Map();

  for (const catalogue of catalogues) {
    const body = read(catalogue);

    if (!body.endsWith('\n')) {
      fail(
        `${catalogue} has no trailing newline.\n` +
          '    Crowdin rewrites these files on every pull, so without one each sync produces a ' +
          'spurious last-line diff that hides the real change.',
      );
    }

    let json;
    try {
      json = JSON.parse(body);
    } catch (error) {
      fail(
        `${catalogue} is not valid JSON: ${error.message}\n` +
          '    The Crowdin sync rejects malformed catalogues, so this breaks localization rather ' +
          'than the build, and nothing else in the toolchain parses these files.',
      );
      continue;
    }

    // `JSON.parse` accepts `null`, a number, a string and an array. `Object.entries(null)`
    // THROWS, which killed the whole script and discarded every other guardrail's
    // diagnostics; a bare string silently flattens to character indices. Rejected by shape
    // before anything walks it.
    if (json === null || typeof json !== 'object' || Array.isArray(json)) {
      fail(
        `${catalogue} parses but is ${
          json === null ? 'null' : Array.isArray(json) ? 'an array' : `a ${typeof json}`
        }, not an object of keys.\n` +
          '    ngx-translate expects an object. A catalogue of any other shape resolves every ' +
          'key to undefined, so the whole locale renders as raw keys.',
      );
      continue;
    }

    const flat = flatten(json, '', new Map(), (path, entry) => {
      // A non-string leaf used to be skipped, which dropped the key from the reference set —
      // and the parity check downstream then blamed the OTHER locale for an "extra" key,
      // pointing at the wrong file for a fault in this one.
      fail(
        `${catalogue} maps \`${path}\` to ${entry === null ? 'null' : typeof entry}, not a ` +
          'string.\n' +
          '    ngx-translate returns it verbatim, so the UI renders it where the words should ' +
          'be. A half-finished Crowdin pull is the usual cause.',
      );
    });
    parsed.set(catalogue, flat);

    for (const [key, value] of flat) {
      if (value.trim() !== '') continue;
      fail(
        `${catalogue} maps \`${key}\` to an empty string. A blank translation renders as a blank ` +
          'label — and where the key is bound to an `aria-label`, as a control with no accessible ' +
          'name, which axe reports as `button-name` (critical) and which is invisible without a ' +
          'screen reader. Use a real string or remove the key.',
      );
    }
  }

  // ---- parity, per i18n directory ----
  let comparisons = 0;
  const directories = new Set(catalogues.map((path) => path.slice(0, path.lastIndexOf('/'))));

  for (const directory of directories) {
    const reference = `${directory}/en.json`;
    const referenceKeys = parsed.get(reference);
    if (!referenceKeys) {
      // An unparseable en.json is already reported above, by name and with the parse error.
      // Reporting it a second time as "no en.json" would be worse than saying nothing: the file
      // is right there, so the reader goes looking for a missing-file problem that does not
      // exist. One defect, one message.
      if (fileExists(reference)) continue;
      fail(
        `${directory} holds translation catalogues but no en.json. English is the reference ` +
          'language and the Crowdin source of truth; without it there is nothing to compare ' +
          'against and no locale can fall back.',
      );
      continue;
    }

    for (const [catalogue, keys] of parsed) {
      if (catalogue === reference || !catalogue.startsWith(`${directory}/`)) continue;
      comparisons += 1;

      const missing = [...referenceKeys.keys()].filter((key) => !keys.has(key));
      const extra = [...keys.keys()].filter((key) => !referenceKeys.has(key));

      if (missing.length) {
        // A WARNING, not a failure, and the asymmetry with `extra` below is deliberate.
        //
        // A missing key is **handled**: `setFallbackLang('en')` means it renders the English
        // string, so the application is correct and merely untranslated. Failing on it would
        // mean every English string extracted has to be translated in the same commit — 1224
        // of them at the last count — by whoever ran the codemod. That is not who translates
        // this product. Crowdin and the translation crew own every non-English catalogue, per
        // the HXP standard, and inventing the content here to satisfy a gate would put
        // unreviewed machine translation in front of customers while *looking* finished.
        //
        // An extra key stays a hard failure: nothing renders it, nobody is paying attention to
        // it, and the translation crew is still being charged to maintain it.
        warn(
          `${catalogue} is missing ${missing.length} key(s) present in ${reference}: ` +
            `${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ', …' : ''}\n` +
            '    Those strings render in English for this locale, which is the fallback working ' +
            'as designed. Never hand-edit a non-English catalogue — Crowdin owns them and ' +
            'overwrites edits on the next pull — so the fix is a Crowdin sync, not a local patch.',
        );
      }
      if (extra.length) {
        fail(
          `${catalogue} carries ${extra.length} key(s) absent from ${reference}: ` +
            `${extra.slice(0, 5).join(', ')}${extra.length > 5 ? ', …' : ''}\n` +
            '    A key no longer in the reference is dead weight the translation crew is still ' +
            'paying to maintain. Push sources with `--delete-obsolete` to clear it.',
        );
      }
    }
  }

  if (comparisons === 0 && catalogues.length > 1) {
    fail(
      `${catalogues.length} catalogues were found but none was compared against an en.json ` +
        'sibling, so the parity half of this gate asserted nothing.',
    );
  }
}

/**
 * A non-English catalogue actually translates something.
 *
 * ## The defect this exists for
 *
 * The first real Crowdin pull opened a pull request carrying nine catalogues, and every one of
 * them was byte-identical to `en.json` — 1,972 keys, 1,972 values the same as English, none
 * different. Nothing in the project was translated yet, and without a skip option Crowdin exports
 * an untranslated string **as its English source**.
 *
 * It was not merely empty, it was destructive: `fr.json` and `de.json` held 75 and 76
 * hand-written translations, and the export overwrote them with English. `Supprimer` became
 * `Delete` in a commit titled "update translations from Crowdin".
 *
 * ## Why `checkTranslationCatalogues` could not see it
 *
 * Read that gate's failure conditions and the reason is plain: malformed JSON, wrong shape, a
 * non-string leaf, a blank value, a key absent from English. An English value satisfies every
 * one of them. It is well-formed, it is a non-empty string, and because the export covers the
 * whole file it is at *perfect* key parity — so even the parity half reported nothing.
 *
 * That gate ran on the pull request and passed. What failed it was
 * `checkLocaleDataRegistered`, on the unrelated ground that seven of the nine locales were new
 * and had no Angular locale data — a real defect and a lucky one, because it is the only reason
 * anybody looked. Restricted to `fr` and `de`, which are already registered,
 * `review:guardrails` printed `Review guardrails passed.` over the destruction of 151 strings.
 *
 * ## The rule
 *
 * Every shared value identical to English means the catalogue translates nothing, and no real
 * translation of five or more strings does that. Individual matches are legitimate and common —
 * `PDF`, `Nuxeo`, `OK` are the same word in French — so the failure needs *all* of them, and a
 * floor of five keys keeps it off a tiny catalogue that could plausibly be all acronyms.
 *
 * The partial case warns instead. Approved-only export fills every unapproved string with its
 * English source, so a high ratio is the normal state of a language with few approvals — and it is
 * also what a pull that overwrites unapproved hand-written translations looks like, which is why it
 * is reported rather than ignored.
 *
 * A skip option is NOT the way out. `skip_untranslated_strings` does not omit the key for our
 * nested JSON, it blanks the value (#293), and `checkCrowdinConfig` forbids both skip options.
 */
function checkCataloguesAreTranslated() {
  const isCatalogue = (path) =>
    /(^|\/)i18n\/[a-z]{2}(-[A-Za-z]{2,4})?\.json$/.test(path) && !isGeneratedLocale(path);
  const catalogues = [...walk('apps', isCatalogue), ...walk('libs', isCatalogue)];

  const flatten = (value, prefix, out) => {
    for (const [key, entry] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (typeof entry === 'string') out.set(path, entry);
      else if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        flatten(entry, path, out);
      }
    }
    return out;
  };

  /** Parses a catalogue, or returns null — malformed files are `checkTranslationCatalogues`'s. */
  const load = (path) => {
    try {
      const json = JSON.parse(read(path));
      if (json === null || typeof json !== 'object' || Array.isArray(json)) return null;
      return flatten(json, '', new Map());
    } catch {
      return null;
    }
  };

  let compared = 0;

  for (const catalogue of catalogues) {
    const locale = catalogue.slice(catalogue.lastIndexOf('/') + 1).replace(/\.json$/, '');
    if (locale === 'en') continue;

    const reference = `${catalogue.slice(0, catalogue.lastIndexOf('/'))}/en.json`;
    if (!fileExists(reference)) continue;

    const english = load(reference);
    const translated = load(catalogue);
    if (!english || !translated) continue;

    const shared = [...translated.keys()].filter((key) => english.has(key));

    // An emptied catalogue, before the key floor gets a chance to skip it.
    //
    // The floor below exists so a legitimately part-translated locale — two approved strings out
    // of two thousand — is not accused of translating nothing. But `continue` is also how a
    // catalogue gutted to `{}` escaped: it contributes no shared keys, the parity half only WARNS
    // about the keys it is missing, and `checkLocaleDataRegistered` and
    // `checkAdvertisedLocalesShip` are both satisfied by the file merely existing. Worse, the
    // `compared === 0` guard at the end could not catch it either, because one healthy sibling
    // increments `compared` and covers for it.
    //
    // Zero is different from few. Per D8e a language is advertised only once it has translations,
    // so a shipped catalogue with none of them is either a destructive sync or a language that
    // should not be shipped yet. Both are worth stopping.
    if (translated.size === 0 && english.size >= 5) {
      fail(
        `${catalogue} contains no translated strings at all, while ${reference} has ` +
          `${english.size}.\n` +
          '    A catalogue may legitimately be SHORT — a key added since the last pull, which ' +
          'English renders through the fallback — but empty means either ' +
          'a sync replaced real translations with nothing, or a language is being shipped before ' +
          'anything was translated for it. D8e: advertise a language when it has translations, ' +
          'not when it is planned.',
      );
      compared += 1;
      continue;
    }

    if (shared.length < 5) continue;

    compared += 1;
    const identical = shared.filter((key) => translated.get(key) === english.get(key));
    if (identical.length !== shared.length) {
      const ratio = identical.length / shared.length;
      if (shared.length >= 25 && ratio >= 0.8) {
        warn(
          `${catalogue} repeats the English string for ${identical.length} of its ` +
            // Floored: 1,964 of 1,972 rounds to "100%", which reads as the all-English failure.
            `${shared.length} keys (${Math.floor(ratio * 100)}%).\n` +
            '    Approved-only export fills every string not yet approved in Crowdin with its ' +
            'English source, so this is the normal state of a language with few approvals. ' +
            'If this is a Crowdin pull, check its diff for real translations turning back into ' +
            'English: the export replaces the whole file, so a translation held here but not ' +
            'approved in Crowdin is overwritten.',
        );
      }
      continue;
    }

    fail(
      `${catalogue} repeats the English string for all ${shared.length} of its keys, so it ` +
        'translates nothing.\n' +
        '    This is what Crowdin exports for a language with nothing approved: approved-only ' +
        'export fills every unapproved string with its English source, under a non-English file ' +
        'name. It is well-formed, non-blank and at perfect key parity with English, which is ' +
        `why ${'`checkTranslationCatalogues`'} passes it.\n` +
        '    Merging it replaces whatever real translations the file held — the first such pull ' +
        'request would have overwritten 151 hand-written French and German strings. It stays ' +
        'red on purpose until translations for this language are approved in Crowdin. Do not ' +
        'reach for a skip option: `checkCrowdinConfig` forbids both (see #293).',
    );
  }

  if (catalogues.length > 1 && compared === 0) {
    fail(
      `${catalogues.length} catalogues were found but none was compared against an en.json ` +
        'sibling with at least 5 shared keys, so this gate asserted nothing. Check the ' +
        '`i18n/<locale>.json` glob and the key floor in `checkCataloguesAreTranslated`.',
    );
  }
}

/**
 * A translation keeps every interpolation placeholder its English source has, and adds none.
 *
 * ngx-translate fills `{{ name }}` from the parameters the call site passes. A translator who
 * drops it loses the data — "Deleted 3 documents" becomes "Deleted documents" — and one who
 * renames or translates it (`{{ nom }}`) renders the braces verbatim, because no parameter of that
 * name exists. Every other catalogue check passes both: the value is a well-formed, non-blank,
 * translated string at full key parity. Crowdin's own QA flags placeholder edits, and it reported
 * 813 issues on Polish while that language sat at 99% translated and 2% approved — so the
 * defect is live in the project, held back only by approval.
 *
 * Compared as a multiset of names: order may change, because word order does. A key absent from
 * the locale is skipped; it renders the English fallback, placeholders and all.
 *
 * The matcher is ngx-translate 17's own `templateMatcher` in `TranslateDefaultParser`, copied
 * rather than approximated: any name without whitespace or braces, and at most ONE space inside
 * each brace pair. `{{  count  }}` is therefore not a placeholder — the runtime leaves it on screen
 * uninterpolated — and a looser grammar here would pass it. Re-check this line when
 * `@ngx-translate/core` moves a major.
 */
function checkCataloguePlaceholders() {
  const PLACEHOLDER = /{{\s?([^{}\s]*)\s?}}/g;
  // Compared as JSON, not joined: the matcher accepts an empty name, and `['']` and `[]` join to
  // the same empty string.
  const names = (value) => [...value.matchAll(PLACEHOLDER)].map((match) => match[1]).sort();
  // A `{{…}}` the runtime does NOT parse (e.g. two spaces inside) is invisible to `names`, so a
  // source with no placeholders and a translation adding `{{  count  }}` compared `[]` with `[]`
  // and passed while the braces render raw. Such tokens are compared separately.
  const TOKEN = /{{[^{}]*}}/g;
  const unparsed = (value) =>
    [...value.matchAll(TOKEN)]
      .map((match) => match[0])
      .filter((token) => !new RegExp(`^${PLACEHOLDER.source}$`).test(token))
      .sort();
  const shown = (list) => (list.length ? list.map((name) => name || '(empty)').join(', ') : 'none');

  const isCatalogue = (path) =>
    /(^|\/)i18n\/[a-z]{2}(-[A-Za-z]{2,4})?\.json$/.test(path) && !isGeneratedLocale(path);
  const catalogues = [...walk('apps', isCatalogue), ...walk('libs', isCatalogue)];

  const flatten = (value, prefix, out) => {
    for (const [key, entry] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (typeof entry === 'string') out.set(path, entry);
      else if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        flatten(entry, path, out);
      }
    }
    return out;
  };
  /** Parses a catalogue, or returns null — malformed files are `checkTranslationCatalogues`'s. */
  const load = (path) => {
    try {
      const json = JSON.parse(read(path));
      if (json === null || typeof json !== 'object' || Array.isArray(json)) return null;
      return flatten(json, '', new Map());
    } catch {
      return null;
    }
  };

  let compared = 0;

  for (const catalogue of catalogues) {
    if (catalogue.endsWith('/en.json')) continue;
    const reference = `${catalogue.slice(0, catalogue.lastIndexOf('/'))}/en.json`;
    if (!fileExists(reference)) continue;

    const english = load(reference);
    const translated = load(catalogue);
    if (!english || !translated) continue;
    compared += 1;

    for (const [key, value] of translated) {
      if (!english.has(key)) continue;
      const expected = names(english.get(key));
      const actual = names(value);
      const strayTokens = unparsed(value);
      if (JSON.stringify(strayTokens) !== JSON.stringify(unparsed(english.get(key)))) {
        fail(
          `${catalogue} maps \`${key}\` to "${value}", which contains ${strayTokens.join(', ')} — ` +
            'braces ngx-translate does not parse as a placeholder, so they render verbatim.\n' +
            '    Fix the translation in Crowdin; never hand-edit a non-English catalogue.',
        );
        continue;
      }
      if (JSON.stringify(expected) === JSON.stringify(actual)) continue;
      fail(
        `${catalogue} maps \`${key}\` to "${value}", whose placeholders are ` +
          `[${shown(actual)}] where ${reference} has [${shown(expected)}].\n` +
          '    ngx-translate fills placeholders by name, so a dropped one loses its value and a ' +
          'renamed or translated one renders its braces verbatim. Never hand-edit a non-English ' +
          'catalogue — fix the translation in Crowdin, which overwrites this file on the next pull.',
      );
    }
  }

  if (catalogues.length > 1 && compared === 0) {
    fail(
      `${catalogues.length} catalogues were found but none was compared against an en.json ` +
        'sibling, so `checkCataloguePlaceholders` asserted nothing.',
    );
  }
}

/**
 * Translator context exists for every string, and for no string that no longer exists.
 *
 * INFO-144 (*Internationalization Strategy for software*) is unambiguous about this: "All strings
 * MUST provide this context as developers cannot know when this information is needed", and "All
 * acronyms or abbreviations MUST be expanded and explained in the comment". Its worked examples
 * are the argument — "Display Manager Failure" cannot be translated without knowing whether
 * "Display" is a noun or a verb, and Japanese needs different words for "from" depending on
 * whether a date range or an email sender is meant.
 *
 * Context lives in a sibling `en.context.json` rather than inside the catalogue, so that it stays
 * in version control next to the string and survives a change of translation tool — the Crowdin
 * RFC makes the same point about keeping the source of truth in the repository rather than in the
 * vendor.
 *
 * Only key parity is enforced. Whether a given sentence of context is *sufficient* is a judgement
 * a script cannot make; what a script can do is guarantee that a new string cannot be added
 * without someone writing something, and that context for a deleted string does not linger and
 * mislead. Keys beginning with `$` are file-level metadata, not strings.
 */
function checkTranslationContext() {
  const isReference = (path) => /(^|\/)i18n\/en\.json$/.test(path);
  const references = [...walk('apps', isReference), ...walk('libs', isReference)];

  if (references.length === 0) {
    fail(
      'No `i18n/en.json` was found under apps/ or libs/, so the translator-context gate ' +
        'asserted nothing.',
    );
    return;
  }

  let compared = 0;
  for (const reference of references) {
    const contextFile = reference.replace(/en\.json$/, 'en.context.json');
    if (!fileExists(contextFile)) {
      fail(
        `${reference} has no sibling en.context.json.\n` +
          '    INFO-144 requires every string to carry translator context: acronyms expanded, ' +
          'product names flagged as do-not-translate, placeholders explained, and enough to ' +
          'disambiguate a word that is a noun in one reading and a verb in another.',
      );
      continue;
    }

    let catalogue;
    let context;
    try {
      catalogue = JSON.parse(read(reference));
      context = JSON.parse(read(contextFile));
    } catch {
      // `checkTranslationCatalogues` reports an unparseable catalogue by name; an unparseable
      // context file is reported here rather than silently skipped.
      if (!fileExists(contextFile)) continue;
      try {
        JSON.parse(read(contextFile));
      } catch (error) {
        fail(`${contextFile} is not valid JSON: ${error.message}`);
      }
      continue;
    }

    // The CONTEXT file's shape is checked above; the CATALOGUE's is not, and `collect` below
    // walks it. `Object.entries(null)` throws and aborts the whole process before any
    // accumulated diagnostic is printed — `checkTranslationCatalogues` records the shape error
    // but cannot stop a later guardrail from crashing on the same file.
    if (catalogue === null || typeof catalogue !== 'object' || Array.isArray(catalogue)) {
      fail(
        `${reference} parses but is ${
          catalogue === null
            ? 'null'
            : Array.isArray(catalogue)
              ? 'an array'
              : `a ${typeof catalogue}`
        }, not an object of keys, so its context cannot be compared.`,
      );
      continue;
    }

    const keys = new Set();
    (function collect(value, prefix) {
      for (const [key, entry] of Object.entries(value)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (typeof entry === 'string') keys.add(path);
        else if (entry && typeof entry === 'object') collect(entry, path);
      }
    })(catalogue, '');

    // `Object.keys(null)` throws, and a context file of any other shape documents nothing.
    if (context === null || typeof context !== 'object' || Array.isArray(context)) {
      fail(
        `${contextFile} parses but is ${
          context === null ? 'null' : Array.isArray(context) ? 'an array' : `a ${typeof context}`
        }, not an object keyed like the catalogue.`,
      );
      continue;
    }

    // A key whose value is blank documents nothing, and comparing key names alone accepted it.
    // An entry that says nothing tells a translator exactly what an absent one does.
    for (const [key, value] of Object.entries(context)) {
      if (key.startsWith('$')) continue;
      if (typeof value === 'string' && value.trim()) continue;
      fail(
        `${contextFile} documents \`${key}\` with ${
          typeof value === 'string'
            ? 'an empty string'
            : `a ${value === null ? 'null' : typeof value}`
        }.\n` +
          '    That is the same as saying nothing, and it satisfies a check that only compares ' +
          'key names. Describe what the string is and where it appears.',
      );
    }

    const documented = new Set(
      Object.keys(context).filter(
        (key) => !key.startsWith('$') && typeof context[key] === 'string' && context[key].trim(),
      ),
    );
    compared += 1;

    const undocumented = [...keys].filter((key) => !documented.has(key));
    const orphaned = [...documented].filter((key) => !keys.has(key));

    if (undocumented.length) {
      fail(
        `${contextFile} is missing context for ${undocumented.length} string(s) in ${reference}: ` +
          `${undocumented.slice(0, 8).join(', ')}${undocumented.length > 8 ? ', …' : ''}\n` +
          '    A translator handed only the English text cannot ask a question; INFO-144 makes ' +
          'the context mandatory for that reason. Say what part of speech it is, what the ' +
          'surrounding UI is, expand any acronym, and name anything that must stay in English.',
      );
    }
    if (orphaned.length) {
      fail(
        `${contextFile} documents ${orphaned.length} key(s) that ${reference} no longer has: ` +
          `${orphaned.slice(0, 8).join(', ')}${orphaned.length > 8 ? ', …' : ''}\n` +
          '    Stale context outlives the string it described and then describes the wrong one ' +
          'after a key is reused. Delete it with the key.',
      );
    }
  }

  if (compared === 0) {
    fail(
      `${references.length} reference catalogue(s) were found but none was compared against a ` +
        'context file, so this gate asserted nothing.',
    );
  }
}

/**
 * Product names and acronyms in the English, and what their translator notes must then say.
 *
 * AC3 of NXSAT-284 asks that product names be flagged do-not-translate and acronyms expanded.
 * `checkTranslationContext` guarantees a note exists; it cannot tell "Visible text in browse" from a
 * note a translator can use. These two lists are the judgement calls a note must carry, kept short
 * and explicit on purpose: a name that is not here is not checked, and adding one is a one-line
 * change reviewed with the notes it forces.
 *
 * Matching is by whole word and case-sensitive, so `AI` matches "AI Insights" and not "Said", and
 * `Nuxeo` also covers "Nuxeo Drive".
 */
const DO_NOT_TRANSLATE_PRODUCTS = [
  'Nuxeo',
  'Knowledge Discovery',
  'Knowledge Enrichment',
  'Content Lake',
  'Hyland',
  'HxAI',
  'ARender',
  'Context API',
  'OAuth',
];
const DO_NOT_TRANSLATE_MARKER = /do not translate/i;
const ACRONYM_EXPANSIONS = {
  AI: 'artificial intelligence',
  API: 'application programming interface',
  CIC: 'Content Innovation Cloud',
  CSV: 'comma-separated values',
  EXIF: 'Exchangeable Image File Format',
  HTML: 'HyperText Markup Language',
  HTTP: 'Hypertext Transfer Protocol',
  ID: 'identifier',
  IPTC: 'International Press Telecommunications Council',
  JSON: 'JavaScript Object Notation',
  NXQL: 'Nuxeo Query Language',
  PDF: 'Portable Document Format',
  REST: 'Representational State Transfer',
  SMTP: 'Simple Mail Transfer Protocol',
  UI: 'user interface',
  URL: 'Uniform Resource Locator',
  XML: 'Extensible Markup Language',
};

function checkTranslatorNotesFlagProductsAndAcronyms() {
  const isReference = (path) => /(^|\/)i18n\/en\.json$/.test(path);
  const references = [...walk('apps', isReference), ...walk('libs', isReference)].filter(
    (path) => !/^apps\/nuxeo-satori-template\//.test(path),
  );
  if (references.length === 0) {
    fail('No en.json was found under apps/ or libs/, so this gate asserted nothing.');
    return;
  }
  // A hyphen is a delimiter: "AI-powered" and "non-JSON" contain the acronym.
  const word = (term) => new RegExp(`(?<!\\w)${escapeRegExp(term)}(?!\\w)`);
  let checked = 0;
  for (const reference of references) {
    const contextFile = reference.replace(/en\.json$/, 'en.context.json');
    if (!fileExists(contextFile)) continue; // checkTranslationContext reports the missing file.
    let english;
    let notes;
    try {
      english = JSON.parse(read(reference));
      notes = JSON.parse(read(contextFile));
    } catch {
      continue; // checkTranslationCatalogues reports malformed JSON.
    }
    const entries = [];
    const collect = (node, prefix) => {
      for (const [key, value] of Object.entries(node)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (value && typeof value === 'object') collect(value, path);
        else if (typeof value === 'string') entries.push([path, value]);
      }
    };
    collect(english, '');
    for (const [key, value] of entries) {
      const note = typeof notes[key] === 'string' ? notes[key] : '';
      if (!note) continue; // checkTranslationContext reports a missing note.
      const products = DO_NOT_TRANSLATE_PRODUCTS.filter((name) => word(name).test(value));
      if (products.length) {
        checked += 1;
        if (!DO_NOT_TRANSLATE_MARKER.test(note)) {
          fail(
            `${contextFile}: the note for \`${key}\` ("${value}") does not flag ` +
              `${products.map((name) => `"${name}"`).join(', ')} as do-not-translate.\n` +
              '    Say what the product is and add "(product name, do not translate)" — the phrase ' +
              '"do not translate" is what this check looks for.',
          );
        }
      }
      const missing = Object.entries(ACRONYM_EXPANSIONS).filter(
        ([acronym, expansion]) =>
          word(acronym).test(value) && !note.toLowerCase().includes(expansion.toLowerCase()),
      );
      if (missing.length) {
        fail(
          `${contextFile}: the note for \`${key}\` ("${value}") does not expand ` +
            `${missing.map(([acronym, expansion]) => `${acronym} (${expansion})`).join(', ')}.\n` +
            '    Write the expansion into the note, for example "CSV = comma-separated values", so a ' +
            'translator knows what the letters stand for and whether to keep them.',
        );
      }
      if (Object.keys(ACRONYM_EXPANSIONS).some((acronym) => word(acronym).test(value)))
        checked += 1;
    }
  }
  if (checked === 0) {
    fail(
      'No catalogue string contains a listed product name or acronym, so this gate asserted nothing.',
    );
  }
}

/**
 * The English `@nuxeo-satori/platform` ships must be the application's English, for exactly the
 * keys the package uses.
 *
 * The package's entry points reference ~300 keys that live only in `apps/nuxeo-ui/public/i18n/en.json`,
 * which does not travel with it. `PLATFORM_EN_TRANSLATIONS` is the copy that does, served by the
 * opt-in `providePlatformEnglishFallback()`. A copy is only worth having while it is the same
 * English: a key reworded in the catalogue and not here would show a host the old wording, and a key
 * the package starts using without a copy would show a host the raw key again. So this fails on a
 * value that differs from `en.json`, a key the package references that the copy lacks, and a key the
 * copy carries that nothing references any more. The fix is always to regenerate.
 */
async function checkPlatformEnglishFallback() {
  const tool = await import(new URL('../tools/i18n/platform-english.mjs', import.meta.url).href);
  if (!fileExists(tool.APP_CATALOGUE)) return; // checkTranslationCatalogues owns a missing catalogue.
  if (tool.platformSourceDirs(repoRoot).length === 0) return; // no platform package in this tree.
  const regenerate = '    Regenerate it: `node tools/i18n/platform-english.mjs`.';
  const shipped = tool.readPlatformEnglish(repoRoot);
  if (!shipped) {
    fail(`${tool.PLATFORM_EN_FILE} is missing or unreadable.\n${regenerate}`);
    return;
  }
  let catalogue;
  let expected;
  try {
    catalogue = tool.flatCatalogue(repoRoot);
    expected = tool.expectedPlatformEnglish(repoRoot);
  } catch {
    return; // checkTranslationCatalogues reports malformed JSON.
  }
  const missing = Object.keys(expected).filter((key) => !(key in shipped));
  const extra = Object.keys(shipped).filter((key) => !(key in expected));
  const drifted = Object.keys(shipped).filter(
    (key) => key in catalogue && shipped[key] !== catalogue[key],
  );
  const sample = (keys) => keys.slice(0, 5).join(', ') + (keys.length > 5 ? ', …' : '');
  if (missing.length) {
    fail(
      `${tool.PLATFORM_EN_FILE} has no English for ${missing.length} key(s) the package uses: ` +
        `${sample(missing)}.\n    A host without the app catalogue would see these as raw keys.\n${regenerate}`,
    );
  }
  if (drifted.length) {
    fail(
      `${tool.PLATFORM_EN_FILE} differs from ${tool.APP_CATALOGUE} for ${drifted.length} key(s): ` +
        `${drifted
          .slice(0, 5)
          .map((key) => `${key} ("${shipped[key]}" vs "${catalogue[key]}")`)
          .join(', ')}.\n${regenerate}`,
    );
  }
  if (extra.length) {
    fail(
      `${tool.PLATFORM_EN_FILE} carries ${extra.length} key(s) the package no longer uses: ` +
        `${sample(extra)}.\n${regenerate}`,
    );
  }
}

/**
 * The translator-context push can actually reach every context file in the repository.
 *
 * `tools/i18n/crowdin-push-context.mjs` used to name one context file, the app's, while
 * `crowdin-conf.yml` already declared a second source mapping for the per-library catalogues
 * NXSAT-284 AC4 will add. Nothing compared the two, so the day a library catalogue landed its
 * context would have been uploaded by nobody while the script still printed a success line.
 * The script's own docstring meanwhile claimed to be gated by a `checkTranslatorContextPush`
 * that did not exist. This is that guardrail, written rather than the claim deleted, because
 * both things it asserts are real invariants:
 *
 * 1. **Every discovered context file is reachable through a declared Crowdin source.** The
 *    script discovers context files by walking `apps/` and `libs/`; a context file whose sibling
 *    catalogue no source glob matches is never uploaded, so its context has nowhere to attach.
 * 2. **The two flatteners agree.** `flattenKeys` in the script is a deliberate second
 *    implementation of `flattenCatalogue` in `app-translate-loader.ts` — the script runs under
 *    plain Node with no TypeScript toolchain. Two copies with nothing comparing them is how a
 *    wrong half survives: if they disagree about what a key looks like, context is attached to
 *    identifiers ngx-translate never asks for, and every symptom appears in Crowdin rather than
 *    in this repository.
 *
 * ## What the two halves of check 2 can and cannot do, stated exactly
 *
 * The first draft of this said the flatteners were "compared by behaviour, not by text" and then
 * compared them by grepping both files for source patterns. Neither half was behavioural, and the
 * comment asserting otherwise is the kind of claim this repository has been caught on repeatedly —
 * a check's docstring describing a stronger check than its body performs.
 *
 * - **The script's flattener is run.** It is ESM under plain Node, so it can be imported and
 *   called on fixtures. This half is genuinely behavioural: it fails when the OUTPUT changes,
 *   whatever the source looks like.
 * - **The loader's flattener is not run.** It is TypeScript, and this script has no compiler. So
 *   its half remains a check that the shape it relies on is still *present* in the source. That is
 *   weaker, and it is a tripwire rather than a proof: it notices the loader being rewritten so the
 *   contract below has to be revisited. `app-translate-loader.spec.ts` is what actually tests the
 *   loader's behaviour.
 */
async function checkTranslatorContextPush() {
  const script = 'tools/i18n/crowdin-push-context.mjs';
  const loader = 'apps/nuxeo-ui/src/app/i18n/app-translate-loader.ts';
  const config = 'crowdin-conf.yml';

  if (!fileExists(script)) {
    fail(
      `${script} is missing. It is the only path translator context reaches Crowdin by — the ` +
        'JSON source format has nowhere to carry it. If it has been removed on purpose, remove ' +
        'this guardrail in the same change.',
    );
    return;
  }

  // 1. Reachability. The globs live in the config; the discovery walk lives in the script.
  if (fileExists(config)) {
    const body = read(config)
      .split('\n')
      .filter((line) => !/^\s*#/.test(line))
      .join('\n');
    const patterns = [...body.matchAll(/'source':\s*'([^']+)'/g)].map(
      ([, path]) =>
        // Same glob translation `checkCrowdinConfig` uses: `**` crosses separators, `*` does not.
        // Built here rather than shared because that one tests existence and this one tests
        // reachability, and a helper answering both would have to be told which.
        new RegExp(
          `^${path
            .replace(/^\//, '')
            .replace(/[.+^${}()|[\]\\]/g, '\\$&')
            .replace(/\*\*/g, '\u0000')
            .replace(/\*/g, '[^/]*')
            .replace(/\u0000/g, '.*')}$`,
        ),
    );
    const contextFiles = [
      ...walk('apps', (path) => /(^|\/)i18n\/en\.context\.json$/.test(path)),
      ...walk('libs', (path) => /(^|\/)i18n\/en\.context\.json$/.test(path)),
    ];
    for (const contextFile of contextFiles) {
      const catalogue = contextFile.replace(/en\.context\.json$/, 'en.json');
      if (!patterns.some((pattern) => pattern.test(catalogue))) {
        fail(
          `${contextFile} documents \`${catalogue}\`, which no \`source\` in ${config} matches.\n` +
            `    ${script} would discover the context and find no Crowdin file to attach it to, ` +
            'and the translators would work from the string alone. Add a source mapping for it.',
        );
      }
    }
  }

  // 1b. The push workflow starts when a file the script reads changes.
  //
  // `paths` and the discovery walk are two independent lists of what counts as a source, and they
  // drifted the moment discovery grew: `libs/**/i18n/en.context.json` was discovered but not
  // watched, so editing translator guidance for a library changed what the job would upload and
  // started nothing. Crowdin then served stale context until some unrelated catalogue change, and
  // stale context is worse than none because a translator believes it.
  const pushWorkflow = '.github/workflows/crowdin-push.yaml';
  if (fileExists(pushWorkflow)) {
    // FIRST: the workflow has to actually run the script.
    //
    // Everything below checks that the right files TRIGGER the job, which is worthless if the job
    // does not invoke the uploader. Deleting the "Push translator context" step left every
    // guardrail green while no translator context reached Crowdin at all — the gate verified the
    // doorbell and never checked whether anyone answered. The green fixture in the selftest had the
    // same gap, which is how it survived being written.
    // A STEP has to run it. Searching the document matches the command inside any block scalar,
    // so this assertion could be satisfied by prose describing the step it is looking for.
    if (runStepOffset(read(pushWorkflow), script) === -1) {
      fail(
        `${pushWorkflow} never runs \`node ${script}\`, so no translator context is uploaded.\n` +
          "    The catalogue goes up through the Crowdin action, but Crowdin's JSON source format " +
          'has nowhere to carry context — this script is the only path it has. Without the step, ' +
          'translators work from the string alone and every gate here still passes.',
      );
    }

    const watched = [...read(pushWorkflow).matchAll(/^\s*-\s*'([^']*i18n[^']*)'/gm)].map(
      ([, glob]) =>
        new RegExp(
          `^${glob
            .replace(/[.+^${}()|[\]\\]/g, '\\$&')
            .replace(/\*\*/g, '\u0000')
            .replace(/\*/g, '[^/]*')
            .replace(/\u0000/g, '.*')}$`,
        ),
    );
    const discovered = [
      ...walk('apps', (path) => /(^|\/)i18n\/en\.context\.json$/.test(path)),
      ...walk('libs', (path) => /(^|\/)i18n\/en\.context\.json$/.test(path)),
    ];
    for (const contextFile of discovered) {
      if (!watched.some((glob) => glob.test(contextFile))) {
        fail(
          `${pushWorkflow} watches no path matching ${contextFile}, which ${script} reads.\n` +
            '    Editing it alone would change what the job uploads and trigger nothing, leaving ' +
            'Crowdin with context the repository has already moved past. Add a `paths` glob for it.',
        );
      }
    }
  }

  // 2a. The script's flattener, RUN on fixtures.
  //
  // Each case is one thing the two implementations must agree a key is. The expectations are the
  // loader's documented behaviour, transcribed — which is why 2b then checks the loader still has
  // that shape, so a change there cannot leave these expectations silently describing nobody.
  const CONTRACT = [
    ['nested objects become dotted keys', { a: { b: 'B', c: 'C' }, d: 'D' }, ['a.b', 'a.c', 'd']],
    ['nesting descends arbitrarily', { a: { b: { c: { d: 'D' } } } }, ['a.b.c.d']],
    // ngx-translate resolves neither, so neither is a string to send context for. An array leaf
    // recursed into yields `a.0`, which is an identifier Crowdin has never heard of.
    ['array leaves are not keys', { a: ['x'], b: 'B' }, ['b']],
    ['null leaves are skipped rather than thrown on', { a: null, b: 'B' }, ['b']],
  ];

  let flattenKeys;
  try {
    ({ flattenKeys } = await import(pathToFileURL(join(repoRoot, script)).href));
  } catch (error) {
    fail(
      `${script} could not be imported, so its flattener was not exercised: ` +
        `${error instanceof Error ? error.message : String(error)}\n` +
        '    It is written to be importable without performing any network call — `main()` is ' +
        'guarded on `process.argv[1]`. If that guard has gone, importing it here would have hit ' +
        'the Crowdin API from a lint gate.',
    );
    return;
  }
  if (typeof flattenKeys !== 'function') {
    fail(
      `${script} no longer exports \`flattenKeys\`, so nothing compares it with the loader's ` +
        'flattener. Two implementations of the same flattening with nothing between them is how ' +
        'a wrong half survives.',
    );
    return;
  }
  for (const [rule, input, expected] of CONTRACT) {
    let actual;
    try {
      actual = flattenKeys(input);
    } catch (error) {
      actual = `threw ${error instanceof Error ? error.message : String(error)}`;
    }
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      fail(
        `${script} \`flattenKeys\` disagrees with the loader on "${rule}".\n` +
          `    ${JSON.stringify(input)} -> ${JSON.stringify(actual)}, expected ` +
          `${JSON.stringify(expected)}.\n` +
          '    The two flatten the same catalogue and must agree on what a key is: a ' +
          'disagreement attaches translator context to identifiers the application never ' +
          'resolves, and every symptom of it appears in Crowdin rather than here.',
      );
    }
  }

  // 2b. The loader still has the shape those expectations were transcribed from.
  //
  // A source check, not a behavioural one, and deliberately labelled as such — the loader is
  // TypeScript and this script has no compiler. It is a tripwire: it fires when the loader is
  // rewritten, so somebody re-derives the contract above instead of trusting a transcription of
  // an implementation that no longer exists.
  if (!fileExists(loader)) {
    fail(`${loader} is missing, so ${script}'s duplicate flattener has nothing to agree with.`);
    return;
  }
  const loaderSource = read(loader);
  const LOADER_SHAPE = [
    ['builds dotted paths', /prefix \? `\$\{prefix\}\.\$\{key\}` : key/],
    ['excludes arrays from the recursion', /!Array\.isArray\(/],
    ['excludes null from the recursion', /value !== null/],
  ];
  for (const [rule, present] of LOADER_SHAPE) {
    if (!present.test(loaderSource)) {
      fail(
        `${loader} no longer visibly "${rule}", so the flattening contract asserted against ` +
          `${script} above was transcribed from an implementation that has changed.\n` +
          '    Re-derive the expectations in `CONTRACT` from the loader as it now is, then ' +
          'update this shape check. Do not simply delete the failing line.',
      );
    }
  }
}

/**
 * Every locale we ship a catalogue for has Angular locale data registered.
 *
 * Translating strings and formatting dates are separate mechanisms. `DatePipe`, `DecimalPipe`
 * and `CurrencyPipe` read Angular's per-locale data, which ships in `@angular/common/locales`
 * and must be registered explicitly; only `en-US` is built in. Asked to format in an
 * unregistered locale a pipe does not degrade — it throws `NG0701`, surfacing as
 * `NG02100: InvalidPipeArgument` wherever a date renders.
 *
 * This is gated because the symptom appears nowhere near the cause. Adding `es.json` is an
 * obviously-complete-looking change; the failure arrives later, as a pipe error on a document
 * list, for a reason that has nothing to do with the file that was added.
 *
 * It is also how the defect was found rather than shipped: adf-core was forcing the app back to
 * `en` on every adf-hx surface (`W14`), so no pipe was ever handed `fr` and the missing data was
 * invisible. Fixing that produced thirty-six console errors on the first French run. **The i18n
 * bug was hiding the l10n bug**, which is the argument for checking the pair rather than either
 * half.
 *
 * `en` is exempt: Angular bundles it.
 */
function checkLocaleDataRegistered() {
  const registration = 'apps/nuxeo-ui/src/app/i18n/register-locale-data.ts';
  if (!fileExists(registration)) {
    fail(
      `${registration} does not exist, but every non-English catalogue needs Angular locale ` +
        'data registered there or its dates throw NG0701 at runtime.',
    );
    return;
  }

  // `['fr', localeFr],` — the locale is the quoted first element of each tuple.
  const registered = new Set(
    [...read(registration).matchAll(/\[\s*'([a-z]{2}(?:-[A-Za-z]{2,4})?)'\s*,/g)].map(
      ([, locale]) => locale,
    ),
  );
  if (registered.size === 0) {
    fail(
      `${registration} yielded no registered locales, so this gate asserted nothing. Its ` +
        'literal shape must have changed — update the parser here before trusting a pass.',
    );
    return;
  }

  const isCatalogue = (path) =>
    /(^|\/)i18n\/[a-z]{2}(-[A-Za-z]{2,4})?\.json$/.test(path) && !isGeneratedLocale(path);
  const catalogues = [...walk('apps', isCatalogue), ...walk('libs', isCatalogue)];
  const shipped = new Set(
    catalogues
      .map((path) => path.slice(path.lastIndexOf('/') + 1).replace(/\.json$/, ''))
      .filter((locale) => locale !== 'en'),
  );

  for (const locale of shipped) {
    if (registered.has(locale)) continue;
    fail(
      `A catalogue ships for "${locale}" but ${registration} registers no Angular locale data ` +
        `for it.\n    Dates, numbers and currency will throw NG0701 the moment anything ` +
        'formats in that locale — and because that happens wherever a date renders, the error ' +
        `will not look like it came from adding ${locale}.json.\n    Import ` +
        `\`@angular/common/locales/${locale}\` and add it to LOCALE_DATA.`,
    );
  }

  for (const locale of registered) {
    if (shipped.has(locale)) continue;
    warn(
      `${registration} registers locale data for "${locale}" but no catalogue ships for it. ` +
        'Harmless, but it is dead weight in the bundle.',
    );
  }
}

/**
 * Every key our templates bind to an accessible name must survive a failed catalogue fetch.
 *
 * `AppTranslateLoader` falls back to `EN_FALLBACK_TRANSLATIONS` when it cannot fetch the app
 * catalogue, and that map is **deliberately partial** — visible text degrading to a raw key is
 * ugly, an accessible name degrading to one is a WCAG 4.1.2 failure. So the rule is not "mirror
 * the catalogue"; it is "mirror the keys that name controls".
 *
 * `settings.themes.search` was the live gap. It is the `[attr.aria-label]` of the themes
 * toolbar's search button, it was in the shipped catalogue and absent from the fallback, so a
 * failed fetch named that control `settings.themes.search`.
 *
 * ## Why nothing else catches this
 *
 * axe checks that a control **has** an accessible name, not that the name is words. A raw key is
 * a perfectly good non-empty string. The blank-name variant of the same defect (finding 4.6) was
 * caught by axe in a single scan; this variant sat through the same audit untouched. The
 * accessibility gates are not a substitute for this check, which is why it is a separate one.
 *
 * Only keys the app's own catalogue owns are in scope. Upstream's SCREAMING_CASE keys arrive
 * from seeded translation folders that the fallback map has no business duplicating.
 */
function checkAccessibleNameFallbacks() {
  const fallbackFile = 'apps/nuxeo-ui/src/app/i18n/en-fallback.ts';
  const catalogueFile = 'apps/nuxeo-ui/public/i18n/en.json';
  for (const required of [fallbackFile, catalogueFile]) {
    if (!fileExists(required)) {
      fail(`${required} does not exist, but the accessible-name fallback gate depends on it.`);
      return;
    }
  }

  /** `'key': 'value'` pairs from the fallback map's object literal. */
  // Both quote styles, and a value Prettier has wrapped onto the next line.
  //
  // The pattern was `/'([^']+)':\s*'([^']*)'/`, which reads a single-quoted value on one line and
  // nothing else. A value containing an apostrophe — `Ask in natural language... e.g. 'PDFs
  // uploaded last week by Administrator'` — makes Prettier switch to double quotes and wrap, and
  // the entry became invisible: the gate reported a key as absent from a file that contains it,
  // and `fallback.size === 0` cannot catch a PARTIAL parse. 317 of 318 entries were seen.
  const fallback = new Map(
    [...read(fallbackFile).matchAll(/'([^']+)':\s*(?:'([^']*)'|"([^"]*)")/g)].map(
      ([, key, single, double]) => [key, single ?? double ?? ''],
    ),
  );
  if (fallback.size === 0) {
    fail(
      `${fallbackFile} yielded no key/value pairs, so this gate asserted nothing. The map's ` +
        'literal shape must have changed — update the parser here before trusting a pass.',
    );
    return;
  }

  // Keys the app catalogue owns. A key bound in a template but absent here belongs to an
  // upstream catalogue and is out of scope.
  //
  // Parsed defensively. An unguarded `JSON.parse` here threw an uncaught `SyntaxError` on a
  // malformed catalogue, which killed the process before the `failures` array was printed — so a
  // trailing comma in `en.json` produced a stack trace and **discarded every other guardrail's
  // diagnostics**, including `checkTranslationCatalogues`'s own clean report of the same file.
  // Found by running that exact negative control. A guardrail that can crash is a guardrail that
  // can silence the others.
  let catalogue;
  try {
    catalogue = JSON.parse(read(catalogueFile));
  } catch {
    // Not reported here: `checkTranslationCatalogues` names the file and the parse error, and one
    // defect should produce one message.
    return;
  }

  // `Object.entries(null)` throws, and `collect` below walks whatever parsed. A catalogue of
  // `null` is valid JSON, so the `try` above does not catch it — the crash landed here instead,
  // killing the process before the accumulated `failures` were printed and discarding every other
  // guardrail's diagnostics, including `checkTranslationCatalogues`'s own clean report of the same
  // file. That guardrail naming the shape earlier does not stop this one crashing on it.
  if (catalogue === null || typeof catalogue !== 'object' || Array.isArray(catalogue)) {
    // Not reported: `checkTranslationCatalogues` names the file and the shape, and one defect
    // should produce one message. Returning is what keeps the rest of the run alive.
    return;
  }

  const owned = new Set();
  (function collect(value, prefix) {
    for (const [key, entry] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (typeof entry === 'string') owned.add(path);
      else if (entry && typeof entry === 'object') collect(entry, path);
    }
  })(catalogue, '');

  const templates = git(['ls-files', '--cached', '--others', '--exclude-standard'])
    .split('\n')
    .filter((file) => /^(libs|apps)\/.+\.html$/.test(file));

  /** @type {Map<string, string> | null} */
  let templateOwnerByHtmlPath = null;
  function componentTsForTemplate(template) {
    const sibling = template.replace(/\.html$/, '.ts');
    if (fileExists(sibling)) return sibling;
    if (!templateOwnerByHtmlPath) {
      templateOwnerByHtmlPath = new Map();
      const tsPredicate = (path) => path.endsWith('.ts');
      const tsFiles = [...walk('apps', tsPredicate), ...walk('libs', tsPredicate)];
      const templateUrlRe = /\btemplateUrl\s*:\s*['"](\.\/)?([^'"]+\.html)['"]/g;
      for (const ownerTs of tsFiles) {
        const dir = dirname(ownerTs).replace(/\\/g, '/');
        for (const match of read(ownerTs).matchAll(templateUrlRe)) {
          const htmlPath = `${dir}/${match[2]}`.replace(/\/+/g, '/');
          templateOwnerByHtmlPath.set(htmlPath, ownerTs);
        }
      }
    }
    return templateOwnerByHtmlPath.get(template) ?? null;
  }

  // `[attr.aria-label]`, `[aria-label]`, `[attr.title]`, `[title]` and `[placeholder]` bound to a
  // single translate-piped literal key, plus visible `<label>` text using the same interpolation
  // shape (NXENG-798 moved global search naming off placeholder). A ternary or a concatenation is
  // not matched, deliberately: this stays a check with no judgement calls in it.
  //
  // `placeholder` remains because the AI assistant input is still placeholder-named. HTML-AAM
  // accepts placeholder as the accessible name of last resort, and the evidence harness's
  // unnamed-control sweep was taught to honour it for that reason. Which opened a hole this gate
  // could not see: neither `shell.search.placeholder` nor `shell.ai.input-placeholder` was in
  // `EN_FALLBACK_TRANSLATIONS`, so a failed catalogue fetch named the global search box
  // `shell.search.placeholder` — a raw key as an accessible name, the precise WCAG 4.1.2 failure
  // this gate exists to stop — while every check passed, including the raw-key sweep, which did not
  // read placeholders or visible labels either.
  //
  // The optional `: { … }` is the pipe's PARAMETERS, and leaving it out made this gate blind to
  // the binding shape the accessible-name fix itself introduced. `nav-drawer.component.html` binds
  // `'nav.tree.toggle' | translate: { name: nodeLabel(node) }`, which the parameterless pattern
  // could not see — so deleting that key from `EN_FALLBACK_TRANSLATIONS` passed this guardrail and
  // restored the raw-key accessible name it exists to prevent. Verified by doing exactly that:
  // the gate stayed green. A parameterised name is MORE likely to be needed here, not less, since
  // it is the form INFO-144's no-concatenation rule pushes every label with a value towards.
  const BINDING =
    /\[(?:attr\.)?(aria-label|title|placeholder)\]="\s*'([^']+)'\s*\|\s*translate(?::\s*\{[^{}]*\})?\s*"/g;

  // `[attr.aria-label]="someMethod() | translate"` (and matTooltip / placeholder) — keys live in the
  // component `.ts` return union and top-level return expressions, not every string in the body.
  const METHOD_BINDING =
    /\[(?:matTooltip|(?:attr\.)?(?:aria-label|title|placeholder))\]="\s*(\w+)\(\)\s*\|\s*translate(?::\s*\{[^{}]*\})?\s*"/g;

  // NXENG-798: global search names via a visible `<label>`, not `[placeholder]`. Only this control
  // is wired here — a repo-wide `<label>{{ … | translate }}</label>` scan would surface dozens of
  // pre-existing catalogue keys that never passed through the attribute binding pattern.
  const HEADER_SEARCH_LABEL_BLOCK =
    /<label\b[^>]*\bfor="global-header-search-input"[^>]*>([\s\S]*?)<\/label>/g;
  const TRANSLATE_INTERPOLATION = /\{\{\s*'([^']+)'\s*\|\s*translate(?::\s*\{[^{}]*\})?\s*\}\}/g;

  // Collected per key rather than per occurrence. `nav.loading` names nine spinners in one
  // template, and nine identical paragraphs asking for one catalogue entry is how a gate earns
  // the reputation that gets it switched off. One missing key, one message, with a count.
  /** @type {Map<string, { attribute: string, sites: string[] }>} */
  const offences = new Map();
  /** Keys in OUR shape that no catalogue defines — a typo renders as the raw key. */
  const undefinedKeys = new Map();
  /** Method-bound names the extractor could not fully resolve — must not pass silently. */
  /** @type {Map<string, { attribute: string, sites: string[], partial: boolean }>} */
  const unresolvedMethodBindings = new Map();
  let bindings = 0;

  /**
   * Upstream's keys are SCREAMING_CASE and ours are lowercase dotted — D4 in
   * docs/i18n-localization-plan.md, which chose that convention precisely so a guardrail could
   * tell "an untranslated upstream key leaked" from "one of ours is missing".
   */
  const isUpstreamShaped = (key) => /^[A-Z][A-Z0-9_]*(\.[A-Z0-9_-]+)+$/.test(key);

  /**
   * Translation keys a method may return, and whether every return branch was statically resolved.
   * @returns {{ keys: string[], partial: boolean }}
   */
  function translationKeysReturnedByMethod(tsSource, methodName) {
    const sourceFile = ts.createSourceFile(
      'component.ts',
      tsSource,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const keys = new Set();
    let partialReturn = false;
    const keyShape = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;

    /** @type {Map<string, { keys: Set<string>, fullyResolved: boolean }>} */
    function forkScope(parent) {
      return new Map(parent);
    }

    function addResolvableKeysFromExpression(expr, target, locals) {
      if (!expr) return;
      if (ts.isParenthesizedExpression(expr)) {
        addResolvableKeysFromExpression(expr.expression, target, locals);
        return;
      }
      if (ts.isStringLiteral(expr) && keyShape.test(expr.text)) {
        target.add(expr.text);
        return;
      }
      if (ts.isIdentifier(expr)) {
        locals.get(expr.text)?.keys.forEach((key) => target.add(key));
        return;
      }
      if (ts.isConditionalExpression(expr)) {
        addResolvableKeysFromExpression(expr.whenTrue, target, locals);
        addResolvableKeysFromExpression(expr.whenFalse, target, locals);
      }
    }

    function initializerFullyResolved(expr, scope) {
      if (!expr) return false;
      if (ts.isParenthesizedExpression(expr))
        return initializerFullyResolved(expr.expression, scope);
      if (ts.isStringLiteral(expr) && keyShape.test(expr.text)) return true;
      if (ts.isConditionalExpression(expr)) {
        return (
          initializerFullyResolved(expr.whenTrue, scope) &&
          initializerFullyResolved(expr.whenFalse, scope)
        );
      }
      if (ts.isIdentifier(expr)) {
        return scope.get(expr.text)?.fullyResolved === true;
      }
      return false;
    }

    function expressionFullyResolved(expr, scope) {
      if (!expr) return false;
      if (ts.isParenthesizedExpression(expr))
        return expressionFullyResolved(expr.expression, scope);
      if (ts.isStringLiteral(expr) && keyShape.test(expr.text)) return true;
      if (ts.isConditionalExpression(expr)) {
        return (
          expressionFullyResolved(expr.whenTrue, scope) &&
          expressionFullyResolved(expr.whenFalse, scope)
        );
      }
      if (ts.isIdentifier(expr)) {
        return scope.get(expr.text)?.fullyResolved === true;
      }
      return false;
    }

    function collectKeysFromReturnExpression(expr, scope) {
      if (!expr) return;
      if (ts.isIdentifier(expr)) {
        scope.get(expr.text)?.keys.forEach((key) => keys.add(key));
        return;
      }
      addResolvableKeysFromExpression(expr, keys, scope);
    }

    function bindConstDeclaration(scope, decl) {
      if (!ts.isIdentifier(decl.name) || !decl.initializer) return;
      const found = new Set();
      addResolvableKeysFromExpression(decl.initializer, found, scope);
      if (found.size) {
        scope.set(decl.name.text, {
          keys: found,
          fullyResolved: initializerFullyResolved(decl.initializer, scope),
        });
      }
    }

    function statementsOf(node) {
      return ts.isBlock(node) ? node.statements : [node];
    }

    function walkScopedStatements(statements, scope) {
      for (const stmt of statements) {
        if (
          ts.isVariableStatement(stmt) &&
          (stmt.declarationList.flags & ts.NodeFlags.Const) !== 0
        ) {
          for (const decl of stmt.declarationList.declarations) bindConstDeclaration(scope, decl);
        } else if (ts.isReturnStatement(stmt)) {
          if (!expressionFullyResolved(stmt.expression, scope)) partialReturn = true;
          collectKeysFromReturnExpression(stmt.expression, scope);
        } else if (ts.isIfStatement(stmt)) {
          walkScopedStatements(statementsOf(stmt.thenStatement), forkScope(scope));
          if (stmt.elseStatement) {
            walkScopedStatements(statementsOf(stmt.elseStatement), forkScope(scope));
          }
        } else if (ts.isSwitchStatement(stmt)) {
          for (const clause of stmt.caseBlock.clauses) {
            walkScopedStatements(clause.statements, forkScope(scope));
          }
        } else if (ts.isTryStatement(stmt)) {
          walkScopedStatements(statementsOf(stmt.tryBlock), forkScope(scope));
          if (stmt.catchClause?.block) {
            walkScopedStatements(stmt.catchClause.block.statements, forkScope(scope));
          }
          if (stmt.finallyBlock) {
            walkScopedStatements(statementsOf(stmt.finallyBlock), forkScope(scope));
          }
        } else if (ts.isBlock(stmt)) {
          walkScopedStatements(stmt.statements, forkScope(scope));
        } else {
          visitReturnsInUnscoped(stmt, scope);
        }
      }
    }

    function visitReturnsInUnscoped(node, scope) {
      if (ts.isReturnStatement(node)) {
        if (!expressionFullyResolved(node.expression, scope)) partialReturn = true;
        collectKeysFromReturnExpression(node.expression, scope);
        return;
      }
      if (
        ts.isFunctionDeclaration(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node) ||
        ts.isGetAccessorDeclaration(node) ||
        ts.isSetAccessorDeclaration(node)
      ) {
        return;
      }
      ts.forEachChild(node, (child) => visitReturnsInUnscoped(child, scope));
    }

    function collectUnionLiteralKeysFromType(typeNode) {
      function visit(node) {
        if (ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)) {
          if (keyShape.test(node.literal.text)) keys.add(node.literal.text);
        } else {
          ts.forEachChild(node, visit);
        }
      }
      if (typeNode) visit(typeNode);
    }

    function blockOrStatementReturns(node) {
      if (ts.isBlock(node)) {
        let reachable = true;
        for (const stmt of node.statements) {
          if (!reachable) break;
          if (statementAlwaysReturns(stmt)) return true;
          if (ts.isIfStatement(stmt) && !stmt.elseStatement) {
            // A guarded return still allows fall-through after the `if`.
            continue;
          }
        }
        return false;
      }
      return statementAlwaysReturns(node);
    }

    function statementAlwaysReturns(stmt) {
      if (ts.isReturnStatement(stmt) || ts.isThrowStatement(stmt)) return true;
      if (ts.isIfStatement(stmt)) {
        const thenReturns = blockOrStatementReturns(stmt.thenStatement);
        const elseReturns = stmt.elseStatement
          ? blockOrStatementReturns(stmt.elseStatement)
          : false;
        return thenReturns && elseReturns;
      }
      return false;
    }

    function methodBodyAlwaysReturns(body) {
      if (!ts.isBlock(body)) return true;
      return blockOrStatementReturns(body);
    }

    function collectReturnLiteralKeys(body) {
      if (!body) return;
      if (!ts.isBlock(body)) {
        const scope = new Map();
        if (!expressionFullyResolved(body, scope)) partialReturn = true;
        collectKeysFromReturnExpression(body, scope);
        return;
      }
      walkScopedStatements(body.statements, new Map());
    }

    function visit(node) {
      const isNamedMethod =
        (ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node)) &&
        node.name &&
        ts.isIdentifier(node.name) &&
        node.name.text === methodName;
      if (isNamedMethod) {
        if (node.type) collectUnionLiteralKeysFromType(node.type);
        if (node.body) {
          collectReturnLiteralKeys(node.body);
          if (ts.isBlock(node.body) && !methodBodyAlwaysReturns(node.body)) {
            partialReturn = true;
          }
        }
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
    return { keys: [...keys], partial: partialReturn };
  }

  function recordBinding(template, attribute, key) {
    bindings += 1;
    if (!owned.has(key)) {
      // A key absent from the catalogue used to be waved through as upstream-owned. That is true
      // for a SCREAMING_CASE key and false for one of ours: `shell.ai.opne` is not upstream's,
      // it is a typo, and ngx-translate renders a missing key as the key itself — so the gate
      // that exists to stop a raw key naming a control could not see the commonest way of
      // producing one. Absence is now only an excuse for the shape that belongs to upstream.
      if (!isUpstreamShaped(key)) {
        if (!undefinedKeys.has(key)) undefinedKeys.set(key, { attribute, sites: [] });
        undefinedKeys.get(key).sites.push(template);
      }
      return;
    }
    if (fallback.has(key) && fallback.get(key).trim() !== '') return;

    if (!offences.has(key)) offences.set(key, { attribute, sites: [] });
    offences.get(key).sites.push(template);
  }

  for (const template of templates) {
    if (!fileExists(template)) continue;
    const html = read(template);
    for (const [, attribute, key] of html.matchAll(BINDING)) {
      recordBinding(template, attribute, key);
    }
    const methodBindings = [...html.matchAll(METHOD_BINDING)];
    if (methodBindings.length === 0) continue;
    const tsPath = componentTsForTemplate(template);
    if (!tsPath) {
      for (const [, methodName] of methodBindings) {
        const attr = `${methodName}()`;
        if (!unresolvedMethodBindings.has(attr)) {
          unresolvedMethodBindings.set(attr, { attribute: attr, sites: [], partial: false });
        }
        unresolvedMethodBindings.get(attr).sites.push(template);
      }
      continue;
    }
    const tsSource = read(tsPath);
    for (const [, methodName] of methodBindings) {
      const { keys: methodKeys, partial } = translationKeysReturnedByMethod(tsSource, methodName);
      if (partial || methodKeys.length === 0) {
        const attr = `${methodName}()`;
        if (!unresolvedMethodBindings.has(attr)) {
          unresolvedMethodBindings.set(attr, { attribute: attr, sites: [], partial });
        }
        unresolvedMethodBindings.get(attr).sites.push(template);
        continue;
      }
      for (const key of methodKeys) {
        recordBinding(template, `${methodName}()`, key);
      }
    }
  }

  const shellTemplate = 'apps/nuxeo-ui/src/app/shell/app-shell.component.html';
  if (fileExists(shellTemplate)) {
    const shellHtml = read(shellTemplate);
    for (const [, labelInner] of shellHtml.matchAll(HEADER_SEARCH_LABEL_BLOCK)) {
      for (const [, key] of labelInner.matchAll(TRANSLATE_INTERPOLATION)) {
        recordBinding(shellTemplate, 'visible label text', key);
      }
    }
  }

  for (const [key, { attribute, sites }] of undefinedKeys) {
    fail(
      `${[...new Set(sites)].join(', ')} binds ${attribute} to \`${key}\`, which no catalogue ` +
        `defines and which is not upstream-shaped.\n` +
        '    ngx-translate renders a key it cannot resolve as the key itself, so this names the ' +
        `control \`${key}\` — the WCAG 4.1.2 failure this gate exists to stop. Either add it to ` +
        `${catalogueFile} with its fallback and context, or fix the spelling.`,
    );
  }

  for (const [methodAttr, { sites, partial }] of unresolvedMethodBindings) {
    const where =
      sites.length === 1
        ? sites[0]
        : `${[...new Set(sites)].join(', ')} (${sites.length} bindings)`;
    if (partial) {
      fail(
        `${where} binds an accessible name to \`${methodAttr}\`, but at least one control-flow ` +
          'path does not return a resolvable catalogue key (for example a call or ternary arm this ' +
          'gate cannot read, or an `if` without a matching `else`/`return` so the method can ' +
          'fall through). Recording only the resolved literals would miss fallbacks for other ' +
          'paths. Bind a literal key, return only resolvable literals/ternaries on every path, or ' +
          'extend translationKeysReturnedByMethod.',
      );
    } else {
      fail(
        `${where} binds an accessible name to \`${methodAttr}\`, but this gate could not resolve ` +
          'any translation keys from that method declaration. A silent pass would miss missing ' +
          'EN_FALLBACK_TRANSLATIONS entries when other templates still carry literal bindings. ' +
          'Bind a literal key, simplify the return shape, or extend translationKeysReturnedByMethod.',
      );
    }
  }

  for (const [key, { attribute, sites }] of offences) {
    const where =
      sites.length === 1
        ? sites[0]
        : `${[...new Set(sites)].join(', ')} (${sites.length} bindings)`;

    if (!fallback.has(key)) {
      fail(
        `${where} binds ${attribute} to \`${key}\`, which ${catalogueFile} owns but ` +
          `${fallbackFile} omits. A failed catalogue fetch names that control with the raw key. ` +
          'Add it to EN_FALLBACK_TRANSLATIONS.',
      );
    } else {
      fail(
        `${where} binds ${attribute} to \`${key}\`, and ${fallbackFile} maps it to an empty ` +
          'string. A failed fetch then leaves the control with no accessible name at all — axe ' +
          '`button-name`, critical. This is exactly how finding 4.6 shipped.',
      );
    }
  }

  if (bindings === 0) {
    fail(
      'No accessible name was found bound to the translate pipe in any template, so this gate ' +
        'asserted nothing. Check the binding pattern before trusting a pass.',
    );
  }
}

/**
 * REMOVED — superseded by `scripts/beta-harness/sanitizer-audit.mjs` check 5.
 *
 * This was a regex pairing check: every `bypassSecurityTrustHtml` had to have a `DOMPurify.sanitize`
 * or `escapeHtml` call in the same class member. It was correct about the risk — the safety of those
 * calls is a *pairing*, not a property of either half — but it had two defects that the AST-based
 * replacement does not.
 *
 * It matched `bypassSecurityTrustHtml` anywhere on a line, including **inside a comment**. Any file
 * that merely documented the helper failed the gate, and the `calls` total it refused to let reach
 * zero was inflated by prose. `renderTrustedHtml`'s own docstring tripped it.
 *
 * It found the enclosing member with `/^ {2}.../`, i.e. two-space indentation, so it only understood
 * class members. A top-level exported function fell back to "start of file", which silently widened
 * the search to every sanitiser call above it — the opposite of the confinement the docstring claimed.
 *
 * Check 5 in `sanitizer-audit.mjs` walks the TypeScript AST instead, so comments are not code, and it
 * additionally catches the forms a regex cannot see at all: `sanitizer['bypassSecurityTrustHtml']`,
 * destructuring, aliasing and `.call()`. The allow-list in `.ai/state/sanitizer-allowlist.json`
 * records the justification for each remaining call, and the budget ratchet means the count can only
 * shrink.
 */

/**
 * Every guardrail, in the order they run.
 *
 * A list rather than a sequence of bare calls so that `--only` can select from it and so the
 * authoritative set is one thing to read. `verify-gate.mjs` does the same and for the same
 * reason: its usage line went stale twice while gates were being added.
 */

/**
 * The packaged Layer 0 defaults — the bootstrap fragment our own bundle contributes to the
 * configuration service (NXSAT-312) — and the marketplace package sources.
 *
 * Shared, because several checks read it and a rename that missed one would leave it checking
 * nothing — `checkAdvertisedLocalesShip` skips a config that does not exist rather than failing
 * on it. `PACKAGED_CONFIG_DIR` is where the package used to stage files for the server's disk; it
 * must not exist any more (`checkInstallerOwnsNoCustomerFile`).
 */
const PACKAGED_CONFIG =
  'nuxeo-agentic-core/src/main/resources/agentic-ui-config/bootstrap.defaults.json';

/**
 * The top-level Layer 0 values a file describes. A fragment is read as is; a served response —
 * the `nuxeo-agentic-ui-config/1` envelope a dev server answers with — is folded fragment by
 * fragment, later winning, which is what the application does for the keys checked here.
 */
function layer0Values(parsed) {
  if (parsed?.format !== 'nuxeo-agentic-ui-config/1') return parsed;
  return Object.assign({}, ...(parsed.fragments ?? []).map((fragment) => fragment?.content ?? {}));
}
const PACKAGE_SOURCES = 'nuxeo-agentic-ui-package/src';
const PACKAGED_CONFIG_DIR = 'nuxeo-agentic-ui-package/src/main/config';

/**
 * Every advertised locale ships a catalogue, and the default is one of them.
 *
 * `checkTranslationCatalogues` validates the files that exist. It never reads
 * `availableLanguages`, so adding `es` to that list without an `es.json` passed — and the
 * comment beside the list claimed otherwise. A reviewer reading it would believe the list was
 * enforced. This makes the claim true instead of removing it.
 */
function checkAdvertisedLocalesShip() {
  /**
   * Every Layer 0 bootstrap config, paired with the catalogue directory ITS OWN application
   * serves.
   *
   * Scoped per application rather than repo-wide: gathering catalogue names across every app meant
   * one app adding `es.json` would let another's config advertise `es` with no catalogue behind it.
   *
   * And it is a LIST rather than the packaged config alone, because checking one config while the
   * repository contains two is the same blindness by omission. `nuxeo-satori-template` is the
   * public Layer 0 example a customer copies, it advertised `fr` and `de`, and it has no catalogue
   * directory and no `TranslateModule` at all — so the example shipped describing two languages it
   * could not render, and this gate did not look at it.
   */
  const configs = [
    [PACKAGED_CONFIG, 'apps/nuxeo-ui/public/i18n'],
    [
      'apps/nuxeo-satori-template/public/agentic-ui-config/bootstrap.json',
      'apps/nuxeo-satori-template/public/i18n',
    ],
  ].filter(([config]) => fileExists(config));

  if (configs.length === 0) {
    fail(
      'No Layer 0 bootstrap config was found, so this gate asserted nothing. Check the paths in ' +
        '`checkAdvertisedLocalesShip`.',
    );
    return;
  }

  for (const [config, catalogueDir] of configs) {
    let parsed;
    try {
      parsed = layer0Values(JSON.parse(read(config)));
    } catch (error) {
      fail(`${config} is not valid JSON: ${error.message}`);
      continue;
    }

    const shipped = new Set(
      [...walk(catalogueDir, (path) => /\/[a-z]{2}(-[A-Za-z]{2,4})?\.json$/.test(path))]
        .map((path) => /([a-z]{2}(?:-[A-Za-z]{2,4})?)\.json$/.exec(path)?.[1])
        .filter(Boolean),
    );

    // `en` needs no catalogue: it is the source language, compiled in as the fallback. Every other
    // advertised locale is a promise that a catalogue exists, so an application with no catalogue
    // directory at all may advertise English and nothing else.
    const needsCatalogue = (locale) => locale !== 'en';

    const advertised = parsed['availableLanguages'];
    if (Array.isArray(advertised)) {
      for (const locale of advertised) {
        if (!needsCatalogue(locale) || shipped.has(locale)) continue;
        fail(
          `${config} advertises "${locale}" in availableLanguages but ${catalogueDir} ships no ` +
            `catalogue for it. Catalogues found: ${[...shipped].sort().join(', ') || '(none)'}.\n` +
            '    Choosing it would render the English fallback throughout, which reads as a ' +
            'broken language rather than an absent one.',
        );
      }
    }

    const fallback = parsed['defaultLanguage'];
    if (typeof fallback === 'string' && needsCatalogue(fallback) && !shipped.has(fallback)) {
      fail(
        `${config} ships \`defaultLanguage: "${fallback}"\` but ${catalogueDir} has no catalogue ` +
          'for it.',
      );
    }
    if (
      typeof fallback === 'string' &&
      Array.isArray(advertised) &&
      !advertised.includes(fallback)
    ) {
      fail(
        `${config} ships \`defaultLanguage: "${fallback}"\` which is absent from ` +
          'availableLanguages, so the default is a language a user cannot switch back to.',
      );
    }
  }
}

/**
 * The Crowdin config points at catalogues that exist, and cannot reach `node_modules`.
 *
 * Two failure modes, both silent and both expensive.
 *
 * A source path that no longer matches anything makes the daily sync a no-op: it uploads
 * nothing, downloads nothing, opens no pull request, and reports success. Nobody notices a job
 * that succeeds. Moving or renaming the catalogue is enough to cause it.
 *
 * And a wildcard in the source path is how the upstream catalogues get swept in. The HXP
 * standard's own example is `/**` + `/**` + `/i18n/en.json`, which with `base_path: "."`
 * matches 48 catalogues under `node_modules` — adf-core's 19 locales, both adf-hx bundles,
 * satori-ui's 15. That pushes another team's strings into our project and bills the
 * translation crew for work already paid for. NXSAT-227 records it as a trap; this makes it
 * unrepeatable rather than remembered.
 */
/**
 * The `files:` entries of a comment-stripped `crowdin-conf.yml`, one chunk of text per entry.
 *
 * Segmented rather than YAML-parsed on purpose: no YAML parser is a declared dependency of this
 * repository. `yaml` and `js-yaml` resolve today only because something else pulls them in —
 * `js-yaml` appears in `package.json` under `overrides`, which pins a transitive version and
 * declares nothing — and a guardrail that imports an undeclared package goes red for a reason
 * unrelated to what it guards the first time the tree resolves differently.
 *
 * Returns `null` when the block is not the flow-mapping form the file uses, so the caller can
 * fail loudly. Guessing entry boundaries is worse than admitting defeat: splitting on each
 * `source` key would attribute an entry's options to the previous one whenever a key order
 * changed, and blindness to which entry an option belongs to is the exact defect this replaced.
 *
 * @param {string} body `crowdin-conf.yml` with comment lines removed
 * @returns {string[]|null}
 */
function crowdinFileEntries(body) {
  const list = /'?files'?\s*:\s*\[([\s\S]*)\]/.exec(body);
  if (!list) return null;
  const entries = [...list[1].matchAll(/\{[^{}]*\}/g)].map(([entry]) => entry);
  return entries.length > 0 ? entries : null;
}

/**
 * Drop whole-line YAML comments, so a token search reads configuration rather than prose.
 *
 * Needed by any check that forbids a token the file also EXPLAINS. Both `crowdin-conf.yml` and
 * the pull workflow argue at length about `skip_untranslated_files` and `export_only_approved`,
 * and a raw search would match the argument — which makes the check impossible to satisfy and,
 * worse, green only while nobody documents the decision.
 *
 * @param {string} body YAML source
 * @returns {string} the same text with `#` comment lines removed
 */
function stripYamlComments(body) {
  return body
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
}

/**
 * Match a workflow input set to a truthy YAML value, in any form the action actually honours.
 *
 * `uses:`-style inputs reach a Docker action as strings, and `entrypoint.sh` compares with
 * `[ "$INPUT_X" = true ]`. So `x: true`, `x: 'true'` and `x: "true"` are all equivalent, and a
 * trailing `# comment` is not part of the value.
 *
 * An anchored `:\s*true\s*$` misses every one of those but the first, and which direction that
 * breaks depends on the check. For a REQUIRED input it is a false red: loud, and the safe way to
 * be wrong. For a FORBIDDEN one it is a silent pass, and the forbidden thing runs while the gate
 * stays green.
 *
 * **So this is for REQUIRED inputs only.** The forbidden ones do not enumerate truthy spellings at
 * all — three rounds of review were lost doing that, one spelling at a time (`true`, then `'true'`
 * and a trailing comment, then `${{ true }}`) — and instead fail closed on any value that is not
 * literally `false`. An expression is resolved by Actions long after this runs, so it can never be
 * cleared here; for a required input that means red, which is correct.
 *
 * @param {string} key the input name
 * @returns {RegExp} matches the key set to true, quoted or not, with or without a trailing comment
 */
function yamlInputIsTrue(key) {
  return new RegExp(`^\\s*['"]?${key}['"]?:\\s*(?:'true'|"true"|true)\\s*(?:#.*)?$`, 'm');
}

/**
 * The steps of a workflow job, each with its byte offset in the document.
 *
 * Checks about a step's inputs must read that step, not the file. `checkCrowdinConfig` already
 * learned this once at the top level — matching `uses: crowdin/github-action` anywhere found a
 * preparation step rather than the one that downloads — and the prohibitions added later scanned
 * the whole workflow again, so an unrelated action carrying `command: ${{ … }}` was classified as
 * an unreadable Crowdin upload. Offsets are kept because the ordering rule compares positions.
 *
 * @param {string} body workflow YAML
 * @returns {{text: string, offset: number}[]} in document order
 */
function workflowSteps(body) {
  const lines = body.split('\n');
  const offsets = [];
  let running = 0;
  for (const line of lines) {
    offsets.push(running);
    running += line.length + 1;
  }

  // Every sequence item under a `steps:` key, whatever its first key happens to be.
  //
  // This used to match `- ` followed by `name:` or `uses:`, which is only the common spelling. A
  // step may validly start with `if:`, `id:`, `env:` or `with:` and carry `uses:` on a later line —
  // and such a Crowdin step was not recognised as a step at all, so every check scoped to Crowdin
  // steps skipped it. Same silent-pass direction as the quoted `uses:` value, one level lower.
  const starts = [];
  let stepsIndent = null;
  let itemIndent = null;
  for (let at = 0; at < lines.length; at += 1) {
    const line = lines[at];
    // Blank and comment-only lines carry no structure. A comment aligned with `steps:` was being
    // read as a dedent, which ENDED enumeration — so a translation upload after such a comment was
    // never examined while the context step before it was.
    if (line.trim() === '' || /^[^\S\n]*#/.test(line)) continue;
    const indent = /^[^\S\n]*/.exec(line)[0].length;

    // Dedenting to or past the `steps:` key ends the block — the next job, or a sibling key.
    if (stepsIndent !== null && indent <= stepsIndent) {
      stepsIndent = null;
      itemIndent = null;
    }
    // `'steps':` and `steps: # comment` are both valid. A second job spelled either way was
    // not a steps block at all, so a forbidden Crowdin step inside it was never enumerated.
    if (/^[^\S\n]*['"]?steps['"]?:[^\S\n]*(?:#.*)?$/.test(line)) {
      stepsIndent = indent;
      itemIndent = null;
      continue;
    }
    if (stepsIndent === null) continue;

    // Only items at the block's own depth. Anything deeper is a list INSIDE a step.
    const item = /^([^\S\n]*)-[^\S\n]+\S/.exec(line);
    if (item && (itemIndent === null || item[1].length === itemIndent)) {
      itemIndent = item[1].length;
      starts.push(offsets[at]);
    }
  }

  return starts.map((offset, at) => ({
    offset,
    text: body.slice(offset, at + 1 < starts.length ? starts[at + 1] : body.length),
  }));
}

/**
 * EVERY value a key is given in a YAML document, with block scalars folded in, and the byte
 * offset of each.
 *
 * Three review rounds were spent on checks that read one declaration in one form, and each round
 * found another way past them. The holes were all the same two mistakes:
 *
 * - **First match only.** `regex.exec` stops at the first declaration, so a harmless
 *   `skip_untranslated_files: false` on a preparation step masked a `true` on the step that
 *   actually downloads. Same for `upload_translations` and the ordering rule.
 * - **First line only.** `download_translations_args: >-` puts the value on the CONTINUATION
 *   lines. Reading the line the key is on captures `>-` and nothing else, while the action
 *   receives the folded text and passes it to the CLI.
 * - **Bare keys only.** `'upload_translations': true` is valid YAML and reaches the action
 *   identically. `crowdin-conf.yml` quotes every key in this repository, so the form is not
 *   hypothetical here, and a workflow may use it too.
 *
 * So callers get all of them and decide, rather than each check re-deriving a parser badly.
 *
 * This is still a matcher and not a YAML parser. It reads block mappings, which is what these
 * workflows are; it does not resolve aliases, and it cannot see inside a flow mapping
 * (`{ key: value }`). Those limits are enforced rather than assumed, which is the only thing that
 * makes a matcher defensible here: `YAML_UNREADABLE` fails any value whose content is unknown, and
 * the callers reject a flow-mapping `with:` outright. An earlier version of this comment claimed
 * the same protection while an alias in `download_translations_args` was read as a harmless
 * literal — the claim was true of the design and false of one branch.
 *
 * @param {string} body YAML source, comments already stripped if the caller needs that
 * @param {string} keyPattern a regex alternation of key names, e.g. `'a|b'`
 * @returns {{value: string, index: number}[]} in document order
 */
function yamlValues(body, keyPattern) {
  const lines = body.split('\n');
  // The optional `- ` matters: a sequence marker can precede the FIRST key of a step, so
  // `- run: node x`, `- with: { … }` and `- uses: …` are all keys on a step. Without it every
  // first-key form was invisible — found by this file's own green control for
  // `checkTranslatorContextPush`, whose fixture writes the uploader as `- run:`.
  const wanted = new RegExp(
    `^([^\\S\\n]*)((?:-[^\\S\\n]+)?)['"]?(?:${keyPattern})['"]?:[^\\S\\n]*(.*)$`,
  );
  // Any key at all, so a block scalar belonging to a key we do NOT want can still be skipped.
  const anyKey = /^([^\S\n]*)(?:-[^\S\n]+)?['"]?[^\s:#'"][^:#]*['"]?:[^\S\n]*(.*)$/;
  const found = [];
  let offset = 0;
  let at = 0;
  while (at < lines.length) {
    const line = lines[at];
    const match = wanted.exec(line);
    const generic = anyKey.exec(line);
    const indent = (match ?? generic)?.[1].length ?? 0;
    const isBlock = generic !== null && /^[|>]/.test(generic[2].trim());

    // The extent of a block scalar: the more-indented lines that follow, blanks included.
    let end = at + 1;
    if (isBlock) {
      while (end < lines.length) {
        if (lines[end].trim() !== '' && /^[^\S\n]*/.exec(lines[end])[0].length <= indent) break;
        end += 1;
      }
    }

    if (match) {
      const first = match[3].replace(/\s+#.*$/, '').trim();
      found.push({
        value: isBlock
          ? lines
              .slice(at + 1, end)
              .map((text) => text.trim())
              .filter((text) => text !== '')
              .join(' ')
          : first,
        index: offset,
        // The column the key itself starts at, sequence marker included, so a caller can tell a
        // STEP-level key from one nested under `with:` or `env:`.
        indent: match[1].length + match[2].length,
      });
    }

    // Skip the block's body either way. Its lines are TEXT, not configuration — a
    // `pull_request_body: |` that explains `skip_untranslated_files: true` in prose is
    // documentation, and reading it as an input made the check fire on its own explanation.
    for (; at < end; at += 1) offset += lines[at].length + 1;
  }
  return found;
}

/**
 * A double-quoted YAML scalar carrying a backslash escape.
 *
 * YAML resolves `"crowdin\u002fgithub-action@v2"` and `"skip\u005funtranslated_files"` to the
 * real action reference and the real key, so an escaped spelling is a working spelling — and every
 * matcher here compares raw text, which sees neither.
 *
 * REJECTED rather than decoded, for the reason the rest of this area rejects rather than parses:
 * implementing YAML's escape table to catch a spelling nobody writes buys a decoder to maintain,
 * while failing closed costs one line and cannot be got subtly wrong. Nothing in these files is
 * double-quoted at all.
 *
 * This is also where the enumeration ends. Previous rounds chased one spelling at a time; an
 * escape is not another spelling but a general encoding, so rejecting the encoding closes the
 * class rather than one member of it.
 */
const YAML_ESCAPED_SCALAR = /"[^"\n]*\\[^"\n]*"/;

/**
 * The keys of a YAML flow mapping, at its own depth, ignoring quoted scalars.
 *
 * A regex cannot do this safely: searching a flow entry for `skip_untranslated_files\s*:` also
 * matches the token inside a LONGER key, inside a quoted value, or inside a nested mapping — so a
 * config that does not declare the option was rejected. Keys only, depth one only.
 *
 * @param {string} entry one flow mapping, e.g. `{ 'source': '…', 'update_option': '…' }`
 * @returns {string[]}
 */
function flowMappingKeys(entry) {
  const keys = [];
  let depth = 0;
  let quote = null;
  let token = '';
  // Whether the scanner is past a `:` and inside that key's VALUE. Without it every depth-one
  // colon read as a key separator, so the second colon of a plain scalar — `{ 'note':
  // skip_untranslated_files:never }` — invented a key that is not declared anywhere.
  let inValue = false;
  for (let at = 0; at < entry.length; at += 1) {
    const ch = entry[at];
    if (quote !== null) {
      if (quote === '"' && ch === '\\') {
        at += 1;
        continue;
      }
      if (ch === quote) quote = null;
      else token += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === '{' || ch === '[') {
      depth += 1;
      token = '';
    } else if (ch === '}' || ch === ']') {
      depth -= 1;
      token = '';
      // Closing a nested collection returns to the middle of the PARENT key's value.
      if (depth === 1) inValue = true;
    } else if (ch === ',') {
      token = '';
      if (depth === 1) inValue = false;
    } else if (ch === '\n') {
      token = '';
    } else if (ch === ':' && depth === 1 && !inValue) {
      keys.push(token.trim());
      token = '';
      inValue = true;
    } else {
      token += ch;
    }
  }
  return keys.filter((key) => key !== '');
}

/**
 * Drop an INLINE YAML comment, leaving a quoted `#` alone.
 *
 * `stripYamlComments` removes whole-line comments; this removes the tail of a line. Needed
 * wherever a token search runs over text that may carry a comment explaining the very token being
 * searched for — `'update_option': 'update_without_changes', # skip_untranslated_files stays
 * forbidden` is a note, not configuration, and reading it as configuration fails a correct file.
 *
 * A `#` only opens a comment at the start of a line or after whitespace, and never inside a quoted
 * scalar — which matters here because every value in `crowdin-conf.yml` is quoted.
 *
 * @param {string} line one line of YAML
 * @returns {string}
 */
function stripInlineComment(line) {
  let quote = null;
  for (let at = 0; at < line.length; at += 1) {
    const ch = line[at];
    if (quote !== null) {
      // Only a double-quoted YAML scalar has backslash escapes; a single-quoted one escapes its
      // delimiter by doubling it, which this loop handles naturally by closing and reopening.
      // Without the skip, `"… \\" # literal"` closed at the escaped quote and the `#` after it
      // was read as a comment — truncating the line before anything that followed.
      if (quote === '"' && ch === '\\') {
        at += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === '#' && (at === 0 || /\s/.test(line[at - 1]))) return line.slice(0, at);
  }
  return line;
}

/** A YAML scalar that explicitly switches an input off. Anything else is treated as on. */
const YAML_FALSE = /^(?:false|'false'|"false")$/;

/**
 * A value whose content this script cannot know.
 *
 * `${{ … }}` is resolved by Actions after the gate runs; `*anchor` is resolved by the YAML parser
 * from a definition elsewhere in the document. Either way the text the CLI receives is not the
 * text here, so nothing can be concluded about it.
 *
 * Callers must treat this as a FAILURE for anything forbidden, never as absence. That is the whole
 * basis on which `yamlValues` is allowed to be a matcher rather than a parser, and it was stated
 * as the justification before it was true of every branch — an alias in `download_translations_args`
 * was being read as a harmless literal. Raised in review; the guarantee now holds where it is
 * claimed.
 */
const YAML_UNREADABLE = /^\*|\$\{\{/;

/**
 * A step that runs the Crowdin action, however its `uses:` value is quoted.
 *
 * `uses: 'crowdin/github-action@…'` is valid workflow YAML. Recognising only the bare form meant a
 * quoted Crowdin step was not recognised as one at all — so every input prohibition scoped to
 * "Crowdin steps" skipped it and passed by absence. Raised in review; the failure direction is the
 * dangerous one, because an unrecognised step is an unchecked step.
 */
/**
 * Whether a step runs the Crowdin action, judged on its STEP-LEVEL `uses` key.
 *
 * Depth matters in both directions. A `uses:` nested under `env:`, under `with:` or inside a block
 * scalar belongs to some other action's configuration, and treating such a step as Crowdin's made
 * the fail-closed rules fire on inputs that never reach Crowdin — a false positive on a valid
 * workflow. A step-level `uses` is the only one GitHub acts on.
 *
 * Liberal about spelling and strict about position: quotes optional on the key and on the value,
 * because the action honours all of those; depth exact, because that is what makes it a step.
 *
 * @param {string} stepText one step, as returned by `workflowSteps`
 * @returns {boolean}
 */
function isCrowdinStep(stepText) {
  return yamlValues(stepText, 'uses').some(
    ({ value, indent }) =>
      indent === stepKeyIndent(stepText) && /^['"]?crowdin\/github-action/.test(value),
  );
}

/**
 * The inputs that hand text straight to the Crowdin CLI.
 *
 * `command:` is one of them, not just a selector: at the pinned SHA the action runs
 * `crowdin $INPUT_COMMAND $INPUT_COMMAND_ARGS` and returns, so `command: download` downloads
 * without `download_translations: true` appearing anywhere.
 */
const ARG_INPUTS = 'command|command_args|download_translations_args';

/**
 * The Crowdin steps of a workflow, each with its byte offset.
 *
 * Every check about a Crowdin input belongs here: narrower than the file, because an unrelated
 * action's inputs are not ours to judge, and wider than "the step with
 * `download_translations: true`", because that is not the only step that can download.
 *
 * @param {string} body workflow YAML
 * @returns {{text: string, offset: number}[]}
 */
function crowdinActionSteps(body) {
  return workflowSteps(body).filter((step) => isCrowdinStep(step.text));
}

/**
 * The offset of the step that actually RUNS a script, or `-1` if no step does.
 *
 * Asserted on execution rather than on text. A document-wide search for the command is satisfied
 * by the same characters appearing inside ANY block scalar — an action input, or the
 * `pull_request_body` prose that explains the pipeline — so "the workflow must attach translator
 * context" could pass on a sentence about attaching translator context. That is the
 * comment-versus-code failure this guardrail file exists to catch, in the guardrail file.
 *
 * `yamlValues` folds `run: |` blocks, so a multi-line script still matches, and it ignores
 * key-shaped text inside other keys' blocks, so prose no longer counts.
 *
 * @param {string} body workflow YAML
 * @param {string} script path the step must invoke with `node`
 * @returns {number} byte offset of the step, or -1
 */
function runStepOffset(body, script) {
  const invocation = new RegExp(`\\bnode\\s+${script.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
  for (const step of workflowSteps(body)) {
    // STEP-LEVEL `run` only. A `run:` nested under `with:` or `env:` is an input or a variable,
    // not a command the runner executes — and accepting one let a Crowdin action that uploads no
    // context satisfy both context assertions.
    if (
      yamlValues(step.text, 'run').some(
        ({ value, indent }) => indent === stepKeyIndent(step.text) && invocation.test(value),
      )
    ) {
      return step.offset;
    }
  }
  return -1;
}

/**
 * The column a step's own keys start at, sequence marker included.
 *
 * `- name: X` puts `name` at the marker's width; the sibling `run:`/`uses:`/`with:` on following
 * lines line up with it. Anything deeper belongs to one of those keys.
 *
 * @param {string} stepText one step, as returned by `workflowSteps`
 * @returns {number}
 */
function stepKeyIndent(stepText) {
  const marker = /^[^\S\n]*-[^\S\n]+/.exec(stepText);
  return marker ? marker[0].length : 0;
}

/**
 * A step's `with:` block — its action INPUTS — with the offset it starts at inside the step.
 *
 * Inputs are children of `with:`, so that is where to look for them. Reading the whole step
 * instead means a `command:` under `env:`, or any nested mapping that happens to reuse an input
 * name, is read as configuration. For a forbidden input that direction is a false positive rather
 * than a silent pass, so it was the less dangerous half of the same mistake `run` made — but it is
 * still a gate failing a workflow that is correct.
 *
 * Returns nothing when the block is absent or in a form `yamlValues` cannot read; the opaque-`with`
 * check fails those separately, so absence here never means "cleared".
 *
 * @param {string} stepText one step, as returned by `workflowSteps`
 * @returns {{text: string, offset: number}|null}
 */
function stepWithBlock(stepText) {
  const keyIndent = stepKeyIndent(stepText);
  const lines = stepText.split('\n');
  let offset = 0;
  for (let at = 0; at < lines.length; at += 1) {
    const isWith = new RegExp(`^[^\\S\\n]{${keyIndent}}['"]?with['"]?:[^\\S\\n]*(?:#.*)?$`).test(
      lines[at].replace(
        /^([^\S\n]*)-([^\S\n]+)/,
        (_, lead, gap) => lead + ' '.repeat(gap.length + 1),
      ),
    );
    if (isWith) {
      // Blank AND comment-only lines carry no structure, exactly as in `workflowSteps`. A comment
      // aligned with `with:` does not end the mapping, and treating it as a dedent dropped every
      // input after it — so an `upload_translations: true` below such a comment was invisible.
      let end = at + 1;
      while (end < lines.length) {
        const structural = lines[end].trim() !== '' && !/^[^\S\n]*#/.test(lines[end]);
        if (structural && /^[^\S\n]*/.exec(lines[end])[0].length <= keyIndent) break;
        end += 1;
      }
      return { text: lines.slice(at + 1, end).join('\n'), offset: offset + lines[at].length + 1 };
    }
    offset += lines[at].length + 1;
  }
  return null;
}

function checkCrowdinConfig() {
  const config = 'crowdin-conf.yml';
  // Two workflows, per D8: push on a source change, pull daily. Both must exist, and both
  // must name the config explicitly, or the action falls back to a default file that is not
  // this one.
  const workflows = ['.github/workflows/crowdin-push.yaml', '.github/workflows/crowdin-pull.yaml'];

  if (!fileExists(config)) {
    fail(
      `${config} is missing. The Crowdin pipeline is NXSAT-227 slice S6; if it has been ` +
        'removed on purpose, remove this guardrail in the same change rather than leaving a ' +
        'check for a file nobody intends to have.',
    );
    return;
  }
  for (const workflow of workflows) {
    if (!fileExists(workflow)) {
      fail(`${workflow} is missing, so ${config} is read by nothing on that half of the sync.`);
      return;
    }
  }

  // Comments stripped first. The file explains why it has no `translation_replace`, and the
  // first run of this check failed on that explanation — the same way the document-shell
  // check failed on the comment describing it.
  const body = read(config)
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
  const sources = [...body.matchAll(/'source':\s*'([^']+)'/g)].map(([, path]) => path);
  // No body-wide `translations` list. It existed, and collecting the mappings that happen to be
  // present is exactly what let a missing one through — the per-entry loop below reads each entry
  // instead, so an absent `translation` is a finding rather than one fewer thing to check.

  if (sources.length === 0) {
    fail(`${config} declares no source file, so the sync would upload nothing and still pass.`);
    return;
  }

  // Wildcards are allowed — D8 uses them, and a `libs/**` entry will be right once there is a
  // library catalogue for it to match. It must arrive WITH that catalogue, though, not ahead
  // of it: see the per-source check below for what an empty pattern costs.
  //
  // What is never allowed is a ROOT that could reach `node_modules`, where the 48 upstream
  // catalogues live. `apps/` and `libs/` sit beside it, so neither can.
  for (const source of sources) {
    if (!/^\/(apps|libs)\//.test(source)) {
      fail(
        `${config} declares the source \`${source}\`, which is not rooted at /apps/ or /libs/.\n` +
          '    With `base_path: "."` any wider root reaches `node_modules` — 48 upstream ' +
          'catalogues at the same relative shape, which would bill the translation crew for ' +
          "another team's strings.",
      );
      continue;
    }
  }
  /**
   * EVERY source pattern must match at least one file, not merely one of them.
   *
   * This check accepted a pattern that matched nothing as long as a sibling matched something,
   * on the reasoning that a forward-looking glob is harmless. It is not. Crowdin treats an
   * unmatched source as an error and fails the run:
   *
   *     File 'apps/nuxeo-ui/public/i18n/en.json'
   *     No sources found for '/libs/**' + '/i18n/en.json' pattern.
   *     Current execution finished with errors
   *
   * The catalogue had already uploaded at that point, so the failure was not even honest about
   * what happened — and because the job failed, the translator-context step that follows it was
   * skipped. A pattern added for a future slice cost the context upload.
   *
   * `--dryrun` does not report it either: the dry run listed the file it would upload and said
   * nothing about the unmatched pattern. So CI is the only place this can be caught before a
   * real run, which is why it is caught here.
   */
  const matches = (source) => {
    const pattern = source.replace(/^\//, '');
    if (!/[*?]/.test(pattern)) return fileExists(pattern);
    const regex = new RegExp(
      `^${pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '\u0000')
        .replace(/\*/g, '[^/]*')
        .replace(/\u0000/g, '.*')}$`,
    );
    return (
      [...walk('apps', (path) => regex.test(path)), ...walk('libs', (path) => regex.test(path))]
        .length > 0
    );
  };
  for (const source of sources.filter((source) => !matches(source))) {
    fail(
      `${config} declares the source \`${source}\` and nothing matches it.\n` +
        '    Crowdin fails the whole run on an unmatched pattern, AFTER uploading the files ' +
        'that did match — so the catalogue lands, the job goes red, and the translator-context ' +
        'step that runs afterwards is skipped. Add a pattern in the change that ships the ' +
        'first file for it, not before.',
    );
  }

  // D8 requires both on EVERY source entry, so both are read per entry.
  //
  // The first version asked `body.includes(required)` once for the whole file. With two
  // mappings that cannot enforce the policy it reports: deleting both options from the
  // `libs/**` entry still passed, because the `apps/*` entry contained the tokens. Caught in
  // review — the same defect class as the corpus check below, a gate whose scope is wider than
  // the claim it prints.
  const entries = crowdinFileEntries(body);
  if (!entries) {
    fail(
      `${config} has a \`files\` block this guardrail cannot segment into entries, so the D8 ` +
        'per-entry options were not checked. It expects the flow-mapping form `files: [ { … }, ' +
        '{ … } ]`. Restore that shape or teach `crowdinFileEntries` the new one — do not leave ' +
        'a gate that reports a policy it silently stopped enforcing.',
    );
  } else {
    if (entries.length !== sources.length) {
      fail(
        `${config} declares ${sources.length} \`source\` value(s) but segments into ` +
          `${entries.length} entr(ies), so at least one entry was not read. The per-entry D8 ` +
          'check cannot be trusted until the two agree.',
      );
    }
    // Values, not just presence. `export_only_approved: 'false'` satisfied the old token check
    // while doing the opposite of what D8 asks for.
    const D8_OPTIONS = [
      [
        // A MUST in the Crowdin Guidelines, not a preference: "when proof-reading is setup,
        // export options MUST be configured so that only approved translations end up in the
        // source code." Whether proof-reading is configured on the project is not established —
        // the team confirming on INTERN-1346 that translations can begin is readiness, not
        // workflow configuration — but `true` is correct either way, because the Guidelines'
        // security risk table marks reputation damage RESOLVED on the grounds that every
        // translation is reviewed internally, and that holds only while this is `true`.
        //
        // Asserted at `true` after a round trip through `false`. See D8g for why that was
        // wrong; the short version is that the mechanical finding behind it (machine
        // pre-translation cannot auto-approve) was true and the conclusion was not.
        'export_only_approved',
        'true',
        'Unapproved work is a draft; exporting it puts half-finished translations in front of ' +
          "users and makes the reviewer's approval meaningless. The Guidelines make it a MUST " +
          'once proof-reading is set up, and rest the "no controversial or profane content" ' +
          'risk rating on every translation being reviewed internally — which holds only while ' +
          'this is `true`, whether or not proof-reading is configured yet. See D8g.',
      ],
      [
        'update_option',
        'update_without_changes',
        'Anything else makes the source-change behaviour the tool default rather than the one ' +
          'recorded as deviation D0a.',
      ],
    ];
    for (const entry of entries) {
      const source = /'?source'?\s*:\s*'([^']+)'/.exec(entry)?.[1] ?? '(entry with no source)';
      for (const [option, expected, why] of D8_OPTIONS) {
        const declared = new RegExp(`'?${option}'?\\s*:\\s*'?([A-Za-z_]+)'?`).exec(entry)?.[1];
        if (declared === undefined) {
          fail(
            `${config} entry \`${source}\` omits \`${option}\`, which D8 in ` +
              `docs/i18n-localization-plan.md requires on every source entry.\n    ${why}`,
          );
        } else if (declared !== expected) {
          fail(
            `${config} entry \`${source}\` sets \`${option}: ${declared}\`, not \`${expected}\`.` +
              `\n    ${why}`,
          );
        }
      }
    }
  }
  // Parsed and compared by HOST, not by substring.
  //
  // `body.includes('hyland.api.crowdin.com')` is the shape CodeQL flags as
  // `js/incomplete-url-substring-sanitization`, and it is right to: that string can sit
  // anywhere in a URL, so `https://evil.example/?x=hyland.api.crowdin.com` would satisfy it.
  // Nothing hostile is going to edit this file, but a check that passes on a URL pointing
  // somewhere else is not checking anything.
  const ENTERPRISE_HOST = 'hyland.api.crowdin.com';
  const declaredBaseUrl = /'base_url':\s*'([^']+)'/.exec(body)?.[1];
  let baseUrlHost = null;
  try {
    baseUrlHost = declaredBaseUrl ? new URL(declaredBaseUrl).host : null;
  } catch {
    baseUrlHost = null;
  }
  if (baseUrlHost !== ENTERPRISE_HOST) {
    fail(
      `${config} sets \`base_url\` to ${declaredBaseUrl ? `\`${declaredBaseUrl}\`` : 'nothing'}, ` +
        `whose host is not ${ENTERPRISE_HOST}.\n` +
        '    The project lives on the Hyland Crowdin Enterprise tenant. A token issued there ' +
        'fails against public crowdin.com with a 401, which reads like a bad secret rather ' +
        'than a wrong host.',
    );
  }

  // The translation pattern has to produce the filename the loader fetches. `%two_letters_code%`
  // yields `fr.json`; a `translation_replace` renaming it to `fr-FR.json` would produce files
  // `AppTranslateLoader` never asks for, and the sync would still look healthy.
  //
  // Read PER ENTRY, for the same reason the D8 options above are. This loop used to iterate the
  // `translation` values it happened to FIND, so an entry that lost its mapping entirely was
  // never mentioned: `sources.length` still said two, the segment count still said two, and the
  // surviving entry's valid pattern carried the check to green. A guardrail that only validates
  // what is present cannot notice an absence — the same shape of blindness as the body-wide
  // options check, left behind in the same function when that one was fixed.
  for (const entry of entries ?? []) {
    const source = /'?source'?\s*:\s*'([^']+)'/.exec(entry)?.[1] ?? '(entry with no source)';
    const translation = /'?translation'?\s*:\s*'([^']+)'/.exec(entry)?.[1];
    if (translation === undefined) {
      fail(
        `${config} entry \`${source}\` declares no \`translation\`, so Crowdin decides where its ` +
          'downloads land.\n' +
          '    `AppTranslateLoader` fetches `i18n/<lang>.json`, and anything else downloads ' +
          'files the application never reads while the sync still reports success.',
      );
      continue;
    }
    // `%file_extension%` is Crowdin's own placeholder for the source file's extension, which
    // is `.json` here. Accepting both spellings rather than only the literal one, because the
    // first version of this check rejected the plan's own form.
    if (!/%two_letters_code%\.(json|%file_extension%)$/.test(translation)) {
      fail(
        `${config} entry \`${source}\` maps translations to \`${translation}\`, which does not ` +
          'end in `%two_letters_code%.json`.\n' +
          '    `AppTranslateLoader` fetches `i18n/<lang>.json` using the two-letter language ' +
          'it was given, so anything else downloads files the application never reads.',
      );
    }
  }
  if (/translation_replace/.test(body)) {
    fail(
      `${config} declares a \`translation_replace\`. Our filenames carry no region, so a ` +
        'rename here produces catalogues the loader cannot find. Adding a regional locale ' +
        'needs a matching change in the loader and in `availableLanguages`.',
    );
  }

  for (const workflow of workflows) {
    const text = read(workflow);
    if (!text.includes(`config: ${config}`)) {
      fail(
        `${workflow} does not pass \`config: ${config}\`, so the action looks for a default file ` +
          'that is not this one.',
      );
    }
    // The variable is set and both workflows have run, so this is no longer about waiting for a
    // project — it is the off switch. Keep it: a fork or a clone of this repository has no
    // Crowdin secrets, and without the gate every push there triggers a job that fails against
    // credentials it was never going to have. A job that is red for a reason nobody can fix is a
    // job people stop reading, including on the day it is red for a real reason.
    if (!text.includes("vars.CROWDIN_SYNC_ENABLED == 'true'")) {
      fail(
        `${workflow} is not gated on \`vars.CROWDIN_SYNC_ENABLED\`, so it runs wherever this ` +
          'repository is forked or cloned — against Crowdin secrets that exist only here.',
      );
    }
  }

  // Signing must be configured where the COMMIT happens, which is inside the action's container.
  //
  // `crowdin/github-action` is `runs: using: docker`. A host-level `ghaction-import-gpg` step
  // therefore signs nothing the action does: it writes to the runner's GnuPG home and the runner's
  // global git config, and the commit is made in a different filesystem and a different git.
  // That step was in `crowdin-pull.yaml`, with correct inputs, succeeding, and having no effect on
  // the guarantee it was there to provide — a step that can neither fail nor work.
  //
  // This is the whole defect class of this file expressed as a check: the pull workflow's own
  // pull-request body tells a reviewer what has been verified, so every promise it makes needs
  // something that actually enforces it.
  // Scoped to the ACTION's own step, not the file.
  //
  // The first version searched the whole file for `gpg_private_key:`, and a host-level
  // `ghaction-import-gpg` step supplies that same input name — so the check passed on precisely
  // the arrangement it exists to reject. Caught by its own negative control, which kept the dead
  // host step in the fixture on purpose.
  const pull = read(workflows[1]);
  // Split with the real step parser, not `name:`/`uses:`-first. An `if:`-first downloader was
  // merged into the step BEFORE it, so that step's `gpg_private_key` satisfied these checks while
  // the actual downloader omitted it — masking by mis-splitting, which is the wrong-step failure
  // in its original form.
  const pullSteps = workflowSteps(pull).map((step) => step.text);
  // The step that DOWNLOADS, not merely the first Crowdin step.
  //
  // `find` on the action name alone was wrong in a way that was invisible while the pull workflow
  // had exactly one Crowdin step — and this change added a second Crowdin step to the PUSH
  // workflow, so the arrangement is no longer hypothetical. A preparation step carrying
  // `gpg_private_key` would satisfy the signing assertion below while the step that actually
  // downloads — and therefore commits — omitted it.
  //
  // And both of these are INPUTS, so both are read from the step's `with:` block rather than from
  // the step. `download_translations: true` and `gpg_private_key` placed under `env:` are passed
  // to the action by nobody — the step does not download and does not sign — yet every assertion
  // here was satisfied by their presence anywhere in the step.
  const crowdinSteps = pullSteps
    .filter((step) => isCrowdinStep(step))
    .map((step) => stepWithBlock(step)?.text ?? '');
  // Through `yamlInputIsTrue`, so a REQUIRED input follows the same YAML semantics as every other
  // one. `download_translations: 'true'` is honoured by the action, and rejecting it reported that
  // the workflow had no downloader at all — a false red that would have been read as a real defect.
  const crowdinStep = crowdinSteps.find((inputs) =>
    yamlInputIsTrue('download_translations').test(inputs),
  );
  if (crowdinStep !== undefined && !/^\s*['"]?gpg_private_key['"]?:/m.test(crowdinStep)) {
    fail(
      `${workflows[1]} runs crowdin/github-action without passing \`gpg_private_key\`, so its ` +
        'commits are unsigned.\n' +
        '    The action declares `runs: using: docker`, so it commits inside its own container. ' +
        'Importing a key in a preceding host step configures the RUNNER, not the container — it ' +
        'succeeds and changes nothing. Pass `gpg_private_key` (and `gpg_passphrase`) to the ' +
        'action itself.',
    );
  }

  // Both skip options are FORBIDDEN, on every channel that reaches the CLI. The Hyland standard's
  // only pull setting is approved-only export; an unapproved string is then filled with its English
  // source, so every catalogue arrives at full key parity.
  //
  // `skip_untranslated_strings` was REQUIRED here until the nightly pull of 29 September 2026
  // (#293). The reasoning was that an untranslated key would be omitted and English would render
  // through the fallback. That was never tested, and it is false for our nested JSON: Crowdin keeps
  // the key and BLANKS the value, so nine catalogues arrived with every unapproved value empty. The
  // Technical Usage Guide had warned of exactly that. `skip_untranslated_files` withholds a
  // language until it is 100% approved, and crowdin-cli 4.14.2 rejects the pair outright.
  //
  // Three ways in, all read below:
  //
  //   1. the action inputs `skip_untranslated_strings` / `skip_untranslated_files`
  //   2. `command`, `command_args`, `download_translations_args` — appended VERBATIM to the
  //      command (`entrypoint.sh` 82-83 and 408-409), so a `--skip-untranslated-*` flag passes
  //      straight through
  //   3. `crowdin-conf.yml`, which the CLI reads the same options from
  //
  // Comments are stripped before matching, because both files explain why these options are
  // absent — a raw text search would fire on the explanation and make the check unfixable.
  if (crowdinStep === undefined) {
    fail(
      `${workflows[1]} contains no \`uses: crowdin/github-action\` step with ` +
        `\`download_translations: true\`${
          crowdinSteps.length
            ? ` (it has ${crowdinSteps.length} Crowdin step(s), none of them ` + 'downloading)'
            : ''
        }, so the signing assertion examined nothing. It cannot download translations in this ` +
        'state.',
    );
  }

  const SKIP_OPTIONS = ['skip_untranslated_strings', 'skip_untranslated_files'];
  const SKIP_FLAG = /--skip-untranslated-(?:strings|files)\b/;
  const WHY_NO_SKIP =
    "    The standard's only pull setting is `export_only_approved`; a string without approval is " +
    'then filled with its English source. Technical Usage Guide: "export options ' +
    '`skip_untranslated_strings` and `skip_untranslated_files` are not specifically useful, and ' +
    'the former can lead to empty translations being exported".\n' +
    '    That is what happened here: with `skip_untranslated_strings` set, the nightly pull of ' +
    '29 September 2026 (#293) exported nine catalogues with every unapproved value blank. ' +
    '`skip_untranslated_files` instead withholds a language until it is 100% approved. See D8d ' +
    'and D8h in docs/i18n-localization-plan.md.';

  const pullCode = stripYamlComments(pull);

  // Fail CLOSED, on EVERY declaration whose value is not literally false.
  //
  // Enumerating truthy spellings was the wrong shape and lost three rounds of review to it:
  // `true`, then `'true'` and a trailing comment, then `${{ true }}`. An expression cannot be
  // evaluated here at all, so for a FORBIDDEN input the only sound rule is that its presence is
  // the defect unless it is provably switched off.
  //
  // Every declaration on a CROWDIN step, not the first, and not the whole file. Every
  // declaration, because a `false` on a preparation step must not mask a `true` on the downloader.
  // Crowdin steps only, because the input means nothing on any other action, and reading the whole
  // file made a mention in `pull_request_body` into a configuration change.
  for (const option of SKIP_OPTIONS) {
    const offending = crowdinActionSteps(pullCode)
      .flatMap((step) => {
        const inputs = stepWithBlock(step.text);
        return inputs ? yamlValues(inputs.text, option) : [];
      })
      .find(({ value }) => !YAML_FALSE.test(value));
    if (offending !== undefined) {
      fail(
        `${workflows[1]} declares \`${option}: ${offending.value}\`.\n` +
          '    Anything but a literal `false` fails here, including `${{ … }}`, because an ' +
          'expression is resolved by Actions long after this runs — so a forbidden input cannot ' +
          'be cleared by making its value unreadable. Every declaration in the file is read, so a ' +
          '`false` on another step does not excuse this one.\n' +
          WHY_NO_SKIP,
      );
    }
  }

  // The argument channels, on EVERY Crowdin step rather than only the boolean downloader.
  //
  // `command:` is a route of its own: at the pinned SHA a step with `command: download` runs
  // `crowdin $INPUT_COMMAND $INPUT_COMMAND_ARGS` and returns before the boolean-driven path, so a
  // SECOND Crowdin step can download with a forbidden flag while `crowdinStep` carries none.
  //
  // Read through block scalars, because `download_translations_args: >-` puts the flag on the
  // following lines and the action folds them before passing them on. Any OTHER literal argument
  // — `--language=fr` is the one this workflow uses — is not this check's business.
  for (const step of crowdinActionSteps(pullCode)) {
    const inputs = stepWithBlock(step.text);
    for (const { value } of inputs ? yamlValues(inputs.text, ARG_INPUTS) : []) {
      const flag = SKIP_FLAG.exec(value)?.[0];
      if (flag !== undefined) {
        fail(
          `${workflows[1]} passes \`${flag}\` to a Crowdin step: \`${value}\`.\n` +
            '    `command`, `command_args` and `download_translations_args` all reach the CLI ' +
            'VERBATIM, so this arrives exactly as the boolean input would.\n' +
            WHY_NO_SKIP,
        );
      } else if (YAML_UNREADABLE.test(value)) {
        fail(
          `${workflows[1]} gives a Crowdin step a command or argument this script cannot read: ` +
            `\`${value}\`.\n` +
            '    An Actions expression is resolved after this gate runs, and a YAML alias is ' +
            'resolved from an anchor elsewhere in the document — either way the text the CLI ' +
            'receives is not the text here, so nothing can tell whether it contains a ' +
            '`--skip-untranslated-*` flag. What cannot be read cannot be cleared, so it fails ' +
            'closed. Pass the command and its flags literally.\n' +
            WHY_NO_SKIP,
        );
      }
    }
  }

  // A KEY, not a substring. `stripYamlComments` drops whole-line comments only, so an inline
  // one — `'preserve_hierarchy': true # skip_untranslated_files stays off` — was read as the
  // option being set, and the gate reported a defect in a correct file.
  //
  // Both shapes, because this file uses both. `yamlValues` reads the block form, which is how the
  // entries are written today — one key per line inside `{ … }`. It cannot see inside a ONE-LINE
  // flow entry, and `crowdinFileEntries` accepts those and the per-entry D8 checks read them, so a
  // single-line entry was a shape the rest of this function understood and this prohibition did
  // not. Scanning the parsed entries closes it without teaching the matcher flow mappings.
  const configBody = stripYamlComments(read(config));
  if (YAML_ESCAPED_SCALAR.test(configBody)) {
    fail(
      `${config} contains an escaped double-quoted scalar.\n` +
        '    YAML resolves `"skip\\u005funtranslated_files"` to the forbidden key, and every ' +
        'check here compares raw text — so an escaped spelling would declare the option while ' +
        'reading as something else entirely.\n' +
        '    Every value in this file is single-quoted; keep it that way.',
    );
  }
  for (const option of SKIP_OPTIONS) {
    const declared =
      yamlValues(configBody, option).length > 0 ||
      (crowdinFileEntries(configBody) ?? []).some((entry) =>
        flowMappingKeys(entry.split('\n').map(stripInlineComment).join('\n')).includes(option),
      );
    if (declared) {
      fail(
        `${config} sets \`${option}\`.\n` +
          '    The CLI reads the export options from the CONFIG FILE too, so moving the option ' +
          'out of the workflow does not remove it.\n' +
          WHY_NO_SKIP,
      );
    }
  }

  // The push workflow must attach translator context, and nothing that uploads translations may
  // come before it.
  //
  // The first half is the live rule. The second guards against reintroducing something that has
  // already been removed: a `seed_translations` step that uploaded the repository's existing
  // non-English catalogues. Seeding itself is a documented SHOULD and still has to happen, but
  // NOT from CI — the standard's mechanism is a one-time `crowdin upload translations
  // --auto-approve-imported` from the command line with the setup token, which is why the CI
  // token refused it. So the step is gone because CI was never the mechanism. See D8f.
  //
  // The rule outlives it because of HOW it failed. It sat between the source upload and the
  // context push, failed on a token scope, and skipped the context step behind it: a failed step
  // skips the rest of the job. That is the shape D8c records — the job goes red over one thing and
  // the translator context INFO-144 requires is silently never attached. It cost nothing only
  // because the context was already in Crowdin and the script is idempotent, which is luck rather
  // than design.
  //
  // So if a translation upload ever comes back, it goes last. It has no bearing on the sources or
  // their context, so there is never a reason for it to precede them.
  const push = read(workflows[0]);
  // The step that RUNS the uploader, not the first place its name appears. A document search
  // matches the same text inside any block scalar, including the `pull_request_body` prose that
  // explains this pipeline — so the context guarantee could be satisfied by a sentence.
  const contextAt = runStepOffset(push, 'tools/i18n/crowdin-push-context.mjs');
  // Fail closed, exactly as the prohibition above does: any declared `upload_translations` counts
  // as an upload unless it is literally `false`. An expression is resolved by Actions long after
  // this runs, so a step whose upload is `${{ … }}` can still run, still fail, and still skip the
  // context step behind it — which is the whole failure this rule exists for.
  //
  // TWO interfaces and EVERY declaration, both learned in review. The action also runs a bare
  // `command:`, so `command: upload translations` uploads without the boolean ever appearing; and
  // reading only the first `upload_translations` let an explicit `false` on an earlier step mask an
  // enabled upload on a later one. The rule is "nothing that uploads may come before context", so
  // what matters is the EARLIEST upload of any kind.
  // A `command:` that cannot be read counts as an upload for the same reason a `${{ }}` boolean
  // counts as `true`: it might be one, and nothing here can rule it out. Failing closed on the
  // forbidden side is the only direction that cannot hide the failure this rule exists for.
  //
  // Both interfaces are read off CROWDIN steps only. `command:` is a generic input name — an
  // unrelated action with `command: ${{ inputs.command }}` cannot invoke Crowdin, and classifying
  // it as an unreadable translation upload failed the gate on a workflow that was correct.
  const uploads = workflowSteps(push)
    .filter((step) => isCrowdinStep(step.text))
    .flatMap((step) => {
      const inputs = stepWithBlock(step.text);
      if (!inputs) return [];
      const at = ({ index }) => step.offset + inputs.offset + index;
      return [
        ...yamlValues(inputs.text, 'upload_translations')
          .filter(({ value }) => !YAML_FALSE.test(value))
          .map(at),
        ...yamlValues(inputs.text, 'command')
          .filter(
            ({ value }) =>
              /^['"]?upload\s+translations\b/.test(value) || YAML_UNREADABLE.test(value),
          )
          .map(at),
      ];
    });
  const translationUploadAt = uploads.length > 0 ? Math.min(...uploads) : -1;

  // An input map this script cannot read, in either workflow.
  //
  // Three forms, all valid YAML, all invisible to `yamlValues`: a flow mapping
  // `with: { command: upload translations }`, an alias `with: *upload_inputs` resolving to a map
  // defined elsewhere, and `with: ${{ … }}`. In every case the checks above read the step as
  // carrying NO inputs — absence, when the truth is unknown, which turns the prohibitions into
  // no-ops.
  //
  // Rejected rather than parsed. These workflows are block-style throughout, nothing needs the
  // other forms, and adding a YAML dependency to a script that has none to cover styles nobody
  // writes is the wrong trade. But the limit has to FAIL, not pass quietly, or the justification
  // for using a matcher at all stops holding — which is exactly how the alias form got in: the
  // flow mapping was rejected and the alias, which hides just as much, was not.
  //
  // CROWDIN steps only. Only a Crowdin step's inputs can hide the three values these checks read,
  // so an unrelated `uses: some-org/action` with `with: { command: value }` is valid and none of
  // our business. The first version of this scanned both whole files and failed it — the same
  // cross-action false positive the `command` scan above had just been scoped to avoid, recreated
  // one check further down within the hour.
  // A flow-style STEP hides even its `uses:`, so `isCrowdinStep` cannot tell whether it is a
  // Crowdin step — and every Crowdin-scoped rule, the opaque-input check below included, skips it
  // rather than failing it. Unreadable a level above the inputs, so it is rejected before anything
  // is scoped.
  for (const workflow of workflows) {
    // Crowdin's own flow steps only. An unrelated `- { uses: actions/checkout@… }` hides nothing
    // this guardrail reads, and failing it would be the cross-action false positive these scopes
    // exist to avoid — the third time that trap has been walked into in this sequence.
    // Crowdin's own flow steps, and any flow step whose action reference is ESCAPED — those two
    // forms combine: `- { uses: "crowdin\\u002fgithub-action@v2", … }` names Crowdin in a
    // spelling the substring test cannot see, inside a shape `yamlValues` cannot read, so neither
    // fail-closed rule reached it. An unreadable action reference is reason enough on its own.
    const flowStep = workflowSteps(stripYamlComments(read(workflow))).find(
      (step) =>
        /^[^\S\n]*-[^\S\n]*\{/.test(step.text) &&
        (/crowdin\/github-action/.test(step.text) || YAML_ESCAPED_SCALAR.test(step.text)),
    );
    const escapedUses = workflowSteps(stripYamlComments(read(workflow))).find((step) =>
      yamlValues(step.text, 'uses').some(
        ({ value, indent }) =>
          indent === stepKeyIndent(step.text) && YAML_ESCAPED_SCALAR.test(value),
      ),
    );
    if (escapedUses !== undefined) {
      fail(
        `${workflow} has a step whose \`uses:\` value is an escaped double-quoted scalar.\n` +
          '    YAML resolves `"crowdin\\u002fgithub-action@v2"` to the Crowdin action; this ' +
          'guardrail compares raw text and would see a different string, so the step would not ' +
          "be recognised as Crowdin's and every Crowdin-scoped rule would skip it.\n" +
          '    Write the reference plainly. Nothing in these workflows is double-quoted.',
      );
    }

    if (flowStep !== undefined) {
      fail(
        `${workflow} declares a step as a YAML flow mapping: ` +
          `\`${flowStep.text.split('\n')[0].trim()}\`.\n` +
          '    The Crowdin guardrails read block-style steps. A flow-style one hides its own ' +
          '`uses:`, so nothing here can tell whether it runs the Crowdin action, and every ' +
          'Crowdin-scoped rule skips it rather than failing it.\n' +
          '    Use the block form (`- uses:` then one `key: value` per line), which is what every ' +
          'other step in these workflows uses.',
      );
    }
  }

  for (const workflow of workflows) {
    for (const step of crowdinActionSteps(stripYamlComments(read(workflow)))) {
      const opaque = step.text
        .split('\n')
        // `- with: { … }` is valid: the sequence marker can precede the first key, and
        // `uses:` then follows on a later line. Without the optional marker the hidden
        // inputs read as absent on exactly the step this check exists for.
        .find((line) => /^\s*(?:-\s+)?['"]?with['"]?:\s*(?:\{|\*|\$\{\{)/.test(line));
      if (opaque !== undefined) {
        fail(
          `${workflow} declares Crowdin step inputs in a form this guardrail cannot read: ` +
            `\`${opaque.trim()}\`.\n` +
            '    A flow mapping, a YAML alias and an expression all hide the keys inside them, ' +
            'so `skip_untranslated_files`, `upload_translations` and `command` would read as ' +
            'ABSENT rather than unknown — which turns three prohibitions into no-ops.\n' +
            '    Use the block form (`with:` then one `key: value` per line), which is what ' +
            'every other step in these workflows uses.',
        );
      }
    }
  }
  if (contextAt === -1) {
    fail(
      `${workflows[0]} never runs \`tools/i18n/crowdin-push-context.mjs\`, so the sources upload ` +
        'without the translator context INFO-144 requires on every string.',
    );
  } else if (translationUploadAt !== -1 && translationUploadAt < contextAt) {
    fail(
      `${workflows[0]} uploads translations before pushing translator context.\n` +
        '    A failed step skips the rest of the job, so a step ahead of the context push can ' +
        'stop it running — which is what happened the first time `seed_translations` ran: it ' +
        'failed on a token scope and the context step behind it was skipped. Move the ' +
        'translation upload after the context push; it has no bearing on either the sources or ' +
        'their context. See D8c in docs/i18n-localization-plan.md.',
    );
  }

  if (!read(workflows[0]).includes('--delete-obsolete')) {
    fail(
      `${workflows[0]} does not pass \`--delete-obsolete\` when uploading sources, which D8 ` +
        'requires. A key removed from English otherwise stays in Crowdin and is offered to a ' +
        'translator who has no way to know it renders nowhere.',
    );
  }
}

/**
 * The packaged marketplace config ships Nuxeo defaults, not a demo rebrand.
 *
 * `PACKAGED_CONFIG` is served by every customer's Nuxeo as the base its own package layers on. The
 * rebrand demo used to edit it — `docs/beta-demo-runbook.md` walked through setting
 * `applicationTitle` to "Acme Content Cloud" and adding an `acme` theme — and told you to
 * run `git checkout --` on it afterwards.
 *
 * That was not run, and the demo branding reached a pull request inside an i18n change, where
 * nobody was looking for it. Every fresh installation would have come up rebranded. No gate
 * saw it; a reviewer did. The demo now edits a gitignored local copy instead (NXSAT-317), but
 * the packaged file is still a tracked file one stray edit away from shipping.
 *
 * So the rule is: the packaged branding must match what the application compiles in. A real
 * branding change is a change to `DEFAULT_APP_BOOTSTRAP_CONFIG` as well, which is a deliberate
 * act rather than a leftover.
 */
function checkPackagedConfigIsNotADemo() {
  const packaged = PACKAGED_CONFIG;
  const compiled = 'libs/shared/app-config/src/lib/bootstrap-config.ts';
  if (!fileExists(packaged) || !fileExists(compiled)) {
    fail(`${packaged} or ${compiled} is missing, so this gate asserted nothing.`);
    return;
  }

  let config;
  try {
    config = JSON.parse(read(packaged));
  } catch (error) {
    fail(`${packaged} is not valid JSON: ${error.message}`);
    return;
  }

  const defaults = read(compiled);
  const compiledTitle = /applicationTitle:\s*'([^']*)'/.exec(defaults)?.[1];
  const compiledTheme = /defaultThemeId:\s*'([^']*)'/.exec(defaults)?.[1];
  if (!compiledTitle || !compiledTheme) {
    fail(
      `Could not read applicationTitle / defaultThemeId out of ${compiled}, so this gate ` +
        'asserted nothing. The shape it parses has changed.',
    );
    return;
  }

  const shippedTitle = config['branding']?.['applicationTitle'];
  if (shippedTitle === undefined || shippedTitle !== compiledTitle) {
    fail(
      `${packaged} ships \`applicationTitle: "${shippedTitle}"\`, which is not the compiled ` +
        `default "${compiledTitle}".\n` +
        '    This is the sample every installation receives. Demo branding belongs in the ' +
        'gitignored local copy `docs/beta-demo-runbook.md` describes; run `git checkout --` on ' +
        'this file. If this is a real branding change, change ' +
        `${compiled} in the same commit.`,
    );
  }

  const shippedTheme = config['defaultThemeId'];
  if (shippedTheme !== undefined && shippedTheme !== compiledTheme) {
    fail(
      `${packaged} ships \`defaultThemeId: "${shippedTheme}"\`, which is not the compiled ` +
        `default "${compiledTheme}". Every fresh installation would start on that theme.`,
    );
  }

  // The demo adds a whole theme here. A customer-supplied theme is a Layer 0 capability and
  // belongs in a CUSTOMER's file, not in the one we ship.
  const shippedThemes = config['themes'];
  if (Array.isArray(shippedThemes) && shippedThemes.length > 0) {
    fail(
      `${packaged} ships ${shippedThemes.length} theme(s): ` +
        `${shippedThemes.map((theme) => theme?.id).join(', ')}.\n` +
        '    The packaged file layers over the compiled themes; shipping one here means every ' +
        'installation gets it. Demo themes belong in the demo, per the runbook.',
    );
  }

  // A loopback URL or a self-declared temporary edit, ANYWHERE in either Layer 0 file.
  //
  // The three checks above were written for the Acme demo leak and they are shaped like it —
  // named keys, one per symptom. That leaves them blind to every other route a local edit takes
  // into this file, and one took it: an NXSAT-279 ARender override pointing the annotation viewer
  // at `http://localhost:8181`, swept in by a `git add -A` during an unrelated i18n change. Its
  // own annotation read "LOCAL DEV ONLY (NXSAT-279) - revert with git checkout". A reviewer found
  // it. This gate did not, which is the second leak of this exact kind it has missed.
  //
  // Hence a rule about the file rather than about particular keys. These are installed on a
  // customer's server, where a loopback address cannot mean anything but a mistake — it resolves
  // to THEIR machine, not ours — and a note saying to revert the edit is the edit admitting it
  // does not belong. The template is included because it is the example a customer copies.
  const layer0 = [packaged, 'apps/nuxeo-satori-template/public/agentic-ui-config/bootstrap.json'];
  for (const file of layer0.filter((path) => fileExists(path))) {
    const body = read(file);

    // The whole of 127.0.0.0/8 and the IPv6 loopback, not just `127.0.0.1`.
    //
    // The first version of this matched `127.0.0.1` literally while the comment above promised
    // "any loopback address". `127.0.0.2` and `http://[::1]:8181` reach the customer's own machine
    // exactly as `127.0.0.1` does, so the narrow regex made the guarantee false rather than
    // partial — and a guarantee that is wrong is worse than one that is absent, because it stops
    // the next person looking.
    const loopback =
      /\b(?:localhost|host\.docker\.internal)\b|\b127\.\d{1,3}\.\d{1,3}\.\d{1,3}\b|\b0\.0\.0\.0\b|\[::1\]|(?<![\w:.])::1(?![\w:.])/.exec(
        body,
      );
    if (loopback) {
      fail(
        `${file} contains the local address \`${loopback[0]}\`.\n` +
          '    This file is installed on a customer server, where a loopback address resolves to ' +
          'their machine — so it can only ever be a developer environment that escaped. Point ' +
          'it at a real host, or revert the file.',
      );
    }

    const temporary = /LOCAL DEV ONLY|revert with git checkout|DO NOT COMMIT|TEMPORARY/i.exec(body);
    if (temporary) {
      fail(
        `${file} says \`${temporary[0]}\` about its own contents.\n` +
          '    A note telling the reader to revert the change is the change admitting it should ' +
          'not ship. Run the `git checkout --` it asks for.',
      );
    }
  }
}

/**
 * The marketplace package installs no configuration file, and no copy that refuses to overwrite.
 *
 * Configuration is contributed by Marketplace packages to the `org.nuxeo.agentic.ui.config`
 * extension point and served by a servlet at `/nuxeo/agentic-ui-config/` (NXSAT-312). Our defaults
 * are a contribution inside the `nuxeo-agentic-core` bundle. So nothing may be copied into
 * `agentic-ui-config` — the servlet owns that path and a file there is never served, which makes
 * such a copy a configuration that looks installed and does nothing — and the package may carry
 * no `src/main/config` directory or `bootstrap.json` at all.
 *
 * `overwrite="false"` is refused everywhere (NXSAT-317). Rehearsed on a real server: an upgrade
 * is an uninstall of the old version, which deletes a package file only while its md5 still
 * matches and so leaves an edited one behind, followed by an install of the new version, whose
 * `overwrite="false"` copy then fails on that file. The install rolls back only its own
 * commands. Result: no version installed, `/nuxeo/agentic-ui/` 404. An omitted attribute is the
 * same copy, because false is Nuxeo's default.
 *
 * The directory walks read the filesystem rather than `git ls-files` on purpose: the Maven
 * assembly stages from disk, so an untracked file left there by hand would still be packaged.
 */
function checkInstallerOwnsNoCustomerFile() {
  const installers = walk(PACKAGE_SOURCES, (path) => path.endsWith('/install.xml'));
  if (installers.length === 0) {
    fail(`No install.xml was found under ${PACKAGE_SOURCES}, so this gate asserted nothing.`);
    return;
  }

  for (const file of installers) {
    const body = read(file);

    // Copies inside a comment are skipped: the one explaining this rule necessarily quotes the
    // attribute. Ranges rather than stripping, and an unterminated comment runs to the end of the
    // file, as it does for an XML parser.
    const comments = [];
    for (let open = body.indexOf('<!--'); open !== -1;) {
      const close = body.indexOf('-->', open + 4);
      const end = close === -1 ? body.length : close + 3;
      comments.push([open, end]);
      open = body.indexOf('<!--', end);
    }
    const inComment = (at) => comments.some(([open, end]) => at >= open && at < end);

    // Nuxeo's Copy command starts with `overwrite` false and assigns `Boolean.parseBoolean` of the
    // attribute only when it is non-empty, so an omitted attribute, or any value but a
    // case-insensitive "true", is `overwrite="false"` with the same failure.
    for (const match of body.matchAll(/<copy\b[^>]*>/g)) {
      if (inComment(match.index)) continue;
      const attribute = (name) =>
        new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`).exec(match[0])?.[2];
      if (/agentic-ui-config/.test(attribute('todir') ?? attribute('tofile') ?? '')) {
        fail(
          `${file} copies into agentic-ui-config: ${match[0].replace(/\s+/g, ' ')}\n` +
            '    The configuration servlet owns /nuxeo/agentic-ui-config/, so nothing on disk there ' +
            'is ever served. Contribute configuration to the org.nuxeo.agentic.ui.config extension ' +
            'point from a bundle instead (NXSAT-312).',
        );
      }
      const value = attribute('overwrite');
      const parsed = value?.toLowerCase();
      if (parsed === 'true') continue;
      const effect = value === undefined ? 'no overwrite attribute' : `overwrite="${value}"`;
      const runsAs = parsed === 'false' ? '' : ', which Nuxeo runs as overwrite="false"';
      fail(
        `${file} has a copy with ${effect}${runsAs}: ${match[0].replace(/\s+/g, ' ')}\n` +
          '    That is only ever used to protect a file someone edits, and it is what breaks the ' +
          'upgrade: the old version is uninstalled, the edited file is left behind because its ' +
          'md5 no longer matches, and this copy then fails on it — leaving no version installed ' +
          '(NXSAT-317). Nothing a customer edits belongs in this package.',
      );
    }
  }

  for (const file of walk(PACKAGED_CONFIG_DIR, () => true)) {
    fail(
      `${file} is packaged for installation onto the server's disk.\n` +
        '    The package installs no configuration file: our defaults are contributed from the ' +
        'nuxeo-agentic-core bundle and served by the configuration servlet (NXSAT-312).',
    );
  }

  for (const file of walk(PACKAGE_SOURCES, (path) => /(^|\/)bootstrap\.json$/.test(path))) {
    if (file.startsWith(`${PACKAGED_CONFIG_DIR}/`)) continue;
    fail(
      `${file} is a bootstrap.json in the marketplace package sources.\n` +
        '    Configuration is contributed to the org.nuxeo.agentic.ui.config extension point from ' +
        'a bundle, never installed as a file (NXSAT-312).',
    );
  }
}

/**
 * No prose in a plain attribute on a component — it is an `@Input`, not HTML.
 *
 * `checkNoHardcodedUiText` knows the HTML attributes that hold text: `title`, `aria-label`,
 * `placeholder`, `alt`. It cannot know that `label` on `<mat-tab>` is one too, because that is
 * a component input and there is no list of every input in every library.
 *
 * Fourteen tab labels sat in that gap — the four across the top of the browse page among them —
 * through a full extraction, a repo-wide residue scan and a pseudo-locale audit of nine routes.
 * The audit did see them; I read its output as upstream noise because Material rendered them.
 *
 * The heuristic is the element name: a hyphenated custom element or a PascalCase one is a
 * component, and a capitalised attribute value on it is prose. Known non-text inputs are
 * exempt, and that list is the part to extend when this reports a false positive — not the
 * element pattern.
 */
function checkNoProseInComponentInputs() {
  const NON_TEXT = new Set([
    'class',
    'style',
    'id',
    'type',
    'name',
    'role',
    'color',
    'appearance',
    'mode',
    'value',
    'href',
    'src',
    'target',
    'rel',
    'align',
    'fxLayout',
    'matTooltipPosition',
    'position',
    'animationDuration',
    'diameter',
    'strokeWidth',
    'fontSet',
    'svgIcon',
  ]);
  const ELEMENT = /<((?:mat|hxp|nxs|app|sat|adf|nx|lib)-[\w-]+|[A-Z][\w-]*)\b([^>]*)>/gs;
  const ATTRIBUTE = /(?<![[(\w.-])([a-zA-Z][\w-]*)="([A-Z][^"<>{}]*)"/g;

  const templates = [
    ...walk('apps', (path) => path.endsWith('.html')),
    ...walk('libs', (path) => path.endsWith('.html')),
  ].filter((path) => !path.startsWith('apps/nuxeo-satori-template/'));

  if (templates.length === 0) {
    fail('No templates were found under apps/ or libs/, so this gate asserted nothing.');
    return;
  }

  for (const template of templates) {
    const body = read(template);
    for (const element of body.matchAll(ELEMENT)) {
      for (const [, attribute, value] of element[2].matchAll(ATTRIBUTE)) {
        if (NON_TEXT.has(attribute)) continue;
        if (value.replace(/[^A-Za-z]/g, '').length < 3) continue;
        fail(
          `${template} sets \`${attribute}="${value}"\` on \`<${element[1]}>\`. That is a ` +
            'component input holding user-facing text, not an HTML attribute, so no pipe runs ' +
            `and the English is hard-coded. Bind it: \`[${attribute}]="'some.key' | translate"\`. ` +
            `If \`${attribute}\` never holds text, add it to NON_TEXT in this check.`,
        );
      }
    }
  }
}

/**
 * The shipped Layer 0 default must be a locale that ships.
 *
 * `zz` is generated by `tools/i18n/pseudo-locale.mjs` for auditing, and selecting it means
 * pointing the packaged defaults, `bootstrap.defaults.json`, at it — a tracked file every
 * customer's Nuxeo serves as its base configuration, so the pseudo-locale would travel into
 * their application. It was committed that way once. Nothing else would have
 * caught it: the build is happy, every test is happy, and the application renders perfectly.
 * In accented gibberish.
 *
 * Also rejects a default that is not in `availableLanguages`, and any `availableLanguages`
 * entry with no catalogue behind it — advertising a language the app cannot render.
 */

/**
 * No Angular template syntax in a document shell.
 *
 * `index.html` is served as-is and Angular never compiles it, so `{{ 'key' | translate }}` in
 * the `<title>` renders those braces as literal text in the browser tab. The i18n extraction
 * codemod did exactly that: it globbed `*.html` and could not tell a component template from
 * the shell that hosts the application.
 *
 * Nothing else caught it. Lint does not parse `index.html` as a template, the build copies it
 * verbatim, and no test opens a browser and reads `document.title` before bootstrap. It was
 * found by loading the page and looking at the tab.
 *
 * The window is short — `AppShellComponent` replaces the title from Layer 0 branding once it
 * boots — but it is the first thing a user sees, and on a slow load it is the only thing.
 */
function checkNoTemplateSyntaxInDocumentShell() {
  const shells = [...walk('apps', (path) => /(^|\/)src\/index\.html$/.test(path))];

  if (shells.length === 0) {
    fail(
      'No `src/index.html` was found under apps/, so this gate asserted nothing. Check the ' +
        'glob before trusting a pass.',
    );
    return;
  }

  for (const shell of shells) {
    // Comments are blanked, not dropped, so the reported line number still points at the file
    // as written. The comment in `index.html` explaining this rule quotes the syntax it
    // forbids, and the first run of this check failed on that comment.
    const body = read(shell).replace(/<!--[\s\S]*?-->/g, (block) => block.replace(/[^\n]/g, ' '));
    for (const [index, line] of body.split('\n').entries()) {
      const match = /\{\{[^}]*\}\}|\*ngIf|\[[\w.]+\]="/.exec(line);
      if (!match) continue;
      fail(
        `${shell}:${index + 1} contains Angular template syntax \`${match[0].trim()}\`. ` +
          'This file is the document shell, not a component template — Angular never compiles ' +
          'it, so the braces render as literal text. Put the string in the component that owns ' +
          'the element, or set it at runtime as `branding.documentTitle` does.',
      );
    }
  }
}

/**
 * `source` with its comments blanked — replaced by spaces, newlines kept, so an offset still maps
 * to the line as written.
 *
 * A scanner rather than a regex, because a comment opener inside a value is not a comment: the
 * `//` of `url("//cdn…")` or `url(//cdn…)`, or `<!--` inside an attribute. Read as comments, they
 * blank whatever follows them, including a real reference. `//` is a comment in `.scss` only; in
 * `.css` and `.html` it never is.
 *
 * @param {string} source
 * @param {string} kind file extension: `html`, `css` or `scss`
 */
function blankComments(source, kind) {
  const blank = (text) => text.replace(/[^\n]/g, ' ');
  let out = '';
  let quote = null;
  let inTag = false;
  let inUrl = false;
  for (let i = 0; i < source.length; i += 1) {
    const c = source[i];
    const rest = source.slice(i, i + 4);
    if (quote) {
      out += c;
      if (c === '\\' && kind !== 'html') out += source[++i] ?? '';
      else if (c === quote || (c === '\n' && kind !== 'html')) quote = null;
      continue;
    }
    if (inUrl) {
      out += c;
      if (c === ')') inUrl = false;
      continue;
    }
    const opener =
      kind === 'html'
        ? !inTag && rest === '<!--'
          ? '-->'
          : null
        : rest.startsWith('/*')
          ? '*/'
          : kind === 'scss' && rest.startsWith('//')
            ? '\n'
            : null;
    if (opener) {
      const end = source.indexOf(opener, i + 2);
      const stop = end === -1 ? source.length : opener === '\n' ? end : end + opener.length;
      out += blank(source.slice(i, stop));
      i = stop - 1;
      continue;
    }
    out += c;
    if (kind === 'html') {
      if (!inTag && c === '<' && /[A-Za-z/]/.test(source[i + 1] ?? '')) inTag = true;
      else if (inTag && c === '>') inTag = false;
      else if (inTag && (c === '"' || c === "'")) quote = c;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (
      c === '(' &&
      /url$/i.test(out.slice(-4, -1)) &&
      !/^\s*["']/.test(source.slice(i + 1))
    ) {
      inUrl = true;
    }
  }
  return out;
}

/**
 * A file the app ships is referenced relative to `<base href>`, never from the server root.
 *
 * The Marketplace package serves the app from `/nuxeo/agentic-ui/`, so `/images/x.svg` resolves
 * to the server root there and 404s while `images/x.svg` resolves to
 * `/nuxeo/agentic-ui/images/x.svg`. The dev server, the unit tests and the e2e suite all use base
 * href `/`, where the two are the same URL, so none of them can see the difference. The login
 * page's background art was a broken image on every packaged install that way (NXSAT-318).
 *
 * What ships is read from `angular.json`, not listed here: the top-level names each
 * application's build `assets` put at the output root — every tracked entry of an input copied to
 * the root, and the first segment of every `output`. A new `public/fonts/` is covered once it is
 * committed. A directory only matches with a segment after it, so the `/login` route is not taken
 * for the shipped `login/` folder.
 *
 * Files under `apps/<app>/` are held to that app's names, and `libs/` to every app's, since any
 * app can load a library. Specs are exempt: they assert URLs rather than load them. In `.ts` only
 * string literals are read, so a comment quoting a path is not a reference; in templates and
 * stylesheets comments are blanked first. Server paths — `/nuxeo/api/…`, `/nuxeo/icons/…`, the
 * `/nuxeo/agentic-ui-config/` servlet — name nothing the app ships, so they never match.
 */
function checkNoRootAbsoluteShippedAssetPaths() {
  const file = 'angular.json';
  if (!fileExists(file)) {
    fail(`${file} was not found, so checkNoRootAbsoluteShippedAssetPaths asserted nothing.`);
    return;
  }

  /** @type {any} */
  let doc;
  try {
    doc = JSON.parse(read(file));
  } catch (error) {
    fail(`${file} is not valid JSON: ${error instanceof Error ? error.message : error}`);
    return;
  }

  /** @type {Map<string, Map<string, boolean>>} app root → shipped top-level name → is a directory */
  const shippedByApp = new Map();
  for (const project of Object.values(doc.projects ?? {})) {
    const p = /** @type {any} */ (project);
    const assets = (p.architect ?? p.targets)?.build?.options?.assets;
    if (!Array.isArray(assets) || typeof p.root !== 'string') continue;
    const names = new Map();
    for (const entry of assets) {
      if (typeof entry === 'string') {
        const absolute = join(repoRoot, entry);
        names.set(entry.split('/').pop(), existsSync(absolute) && statSync(absolute).isDirectory());
        continue;
      }
      const output = String(entry.output ?? '').replace(/^\/+|\/+$/g, '');
      if (output) {
        names.set(output.split('/')[0], true);
        continue;
      }
      const input = String(entry.input ?? '').replace(/\/+$/, '');
      for (const tracked of git(['ls-files', '--', input]).split('\n').filter(Boolean)) {
        const rest = tracked.slice(input.length + 1).split('/');
        names.set(rest[0], (names.get(rest[0]) ?? false) || rest.length > 1);
      }
    }
    if (names.size) shippedByApp.set(p.root.replace(/\/+$/, ''), names);
  }

  if (shippedByApp.size === 0) {
    fail(
      `No application in ${file} declares build assets, so checkNoRootAbsoluteShippedAssetPaths ` +
        'asserted nothing. Check how it reads the asset configuration before trusting a pass.',
    );
    return;
  }

  const escape = (name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  /**
   * Leading form, for a `.ts` string literal; embedded form, for markup and CSS. A value opens
   * after a quote or `url(` only, so nothing inside a URL — a query's `?path=/images/x.svg` —
   * can open one. A quote after `+` is the tail of a concatenation
   * (`[src]="base + '/images/x.svg'"`), placed by whatever precedes it, as `isSuffix` decides
   * for `.ts`.
   *
   * Two shapes are deliberately not matched. An unquoted attribute value (`src=/images/x.svg`)
   * cannot be committed: the pre-commit hook runs Prettier on every template, which quotes it.
   * A later `srcset` candidate (`a.svg 1x, /images/x.svg 2x`) — nothing here uses `srcset`.
   * Openers for both were tried, and each matched inside ordinary query strings.
   */
  const patternsFor = (names) => {
    const dirs = [...names].filter(([, dir]) => dir).map(([name]) => escape(name));
    const files = [...names].filter(([, dir]) => !dir).map(([name]) => escape(name));
    const alternatives = [
      ...(dirs.length ? [`(?:${dirs.join('|')})/`] : []),
      ...(files.length ? [`(?:${files.join('|')})(?=$|[\\s?#"'\`),>])`] : []),
    ].join('|');
    return {
      leading: new RegExp(`^/(?:${alternatives})`),
      embedded: new RegExp(`(?:(?<!\\+\\s*)["'\`]|[uU][rR][lL]\\()\\s*/(?:${alternatives})`, 'g'),
    };
  };
  /**
   * A literal that only ends a URL — a template's `${base}/images/x.svg`, or `base +
   * '/images/x.svg'` — is not root-absolute: whatever precedes it decides where it points.
   */
  const isSuffix = (node) =>
    ts.isTemplateMiddle(node) ||
    ts.isTemplateTail(node) ||
    (ts.isBinaryExpression(node.parent) &&
      node.parent.operatorToken.kind === ts.SyntaxKind.PlusToken &&
      node.parent.right === node);
  const everyApp = new Map([...shippedByApp.values()].flatMap((names) => [...names]));
  const patternsByApp = new Map(
    [...shippedByApp].map(([root, names]) => [root, patternsFor(names)]),
  );
  const libPatterns = patternsFor(everyApp);

  const sources = git(['ls-files', '--cached', '--others', '--exclude-standard'])
    .split('\n')
    .filter((path) => /^(apps|libs)\/.+\.(ts|html|scss|css)$/.test(path))
    .filter((path) => !/\.spec\.(ts|html)$/.test(path));

  let scanned = 0;
  for (const path of sources) {
    if (!fileExists(path)) continue;
    const appRoot = [...patternsByApp.keys()].find((root) => path.startsWith(`${root}/`));
    const patterns = path.startsWith('libs/') ? libPatterns : patternsByApp.get(appRoot);
    if (!patterns) continue;
    scanned += 1;

    const body = read(path);
    /** @type {{ line: number, text: string }[]} */
    const hits = [];
    if (path.endsWith('.ts')) {
      const source = ts.createSourceFile(path, body, ts.ScriptTarget.Latest, true);
      const visit = (node) => {
        if (
          ts.isStringLiteral(node) ||
          ts.isNoSubstitutionTemplateLiteral(node) ||
          ts.isTemplateHead(node) ||
          ts.isTemplateMiddle(node) ||
          ts.isTemplateTail(node)
        ) {
          const text = node.text;
          patterns.embedded.lastIndex = 0;
          if ((!isSuffix(node) && patterns.leading.test(text)) || patterns.embedded.test(text)) {
            const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
            hits.push({ line: line + 1, text });
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    } else {
      const stripped = blankComments(body, path.split('.').pop());
      // The whole file, not line by line: `url(` and its path may sit on different lines. The
      // reported line is the one the path itself is on.
      const lines = stripped.split('\n');
      for (const match of stripped.matchAll(patterns.embedded)) {
        const line = stripped.slice(0, match.index + match[0].length).split('\n').length;
        hits.push({ line, text: lines[line - 1].trim() });
      }
    }

    for (const hit of hits) {
      fail(
        `${path}:${hit.line} references a file the app ships from the server root: ` +
          `${JSON.stringify(hit.text.slice(0, 120))}.\n` +
          '    The Marketplace package serves the app from /nuxeo/agentic-ui/, so a leading "/"\n' +
          '    resolves outside it and 404s; dev and every test use base href "/", where it looks\n' +
          '    fine. Drop the leading "/" so it resolves against <base href> (NXSAT-318).',
      );
    }
  }

  if (scanned === 0) {
    fail(
      'checkNoRootAbsoluteShippedAssetPaths scanned no source files under apps/ or libs/, so it ' +
        'asserted nothing. Check the file glob before trusting a pass.',
    );
  }
}

/**
 * No prose in a plain attribute on a component — it is an `@Input`, not HTML.
 *
 * `checkNoHardcodedUiText` knows the HTML attributes that hold text: `title`, `aria-label`,
 * `placeholder`, `alt`. It cannot know that `label` on `<mat-tab>` is one too, because that is
 * a component input and there is no list of every input in every library.
 *
 * Fourteen tab labels sat in that gap — the four across the top of the browse page among them —
 * through a full extraction, a repo-wide residue scan and a pseudo-locale audit of nine routes.
 * The audit did see them; I read its output as upstream noise because Material rendered them.
 *
 * The heuristic is the element name: a hyphenated custom element or a PascalCase one is a
 * component, and a capitalised attribute value on it is prose. Known non-text inputs are
 * exempt, and that list is the part to extend when this reports a false positive — not the
 * element pattern.
 */

/**
 * The shipped Layer 0 default must be a locale that ships.
 *
 * `zz` is generated by `tools/i18n/pseudo-locale.mjs` for auditing, and selecting it means
 * pointing the packaged defaults, `bootstrap.defaults.json`, at it — a tracked file every
 * customer's Nuxeo serves as its base configuration, so the pseudo-locale would travel into
 * their application. It was committed that way once. Nothing else would have
 * caught it: the build is happy, every test is happy, and the application renders perfectly.
 * In accented gibberish.
 *
 * Also rejects a default that is not in `availableLanguages`, and any `availableLanguages`
 * entry with no catalogue behind it — advertising a language the app cannot render.
 */
function checkShippedDefaultLanguage() {
  const config = PACKAGED_CONFIG;
  if (!fileExists(config)) {
    fail(`${config} was not found, so this gate asserted nothing. Check the path.`);
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(read(config));
  } catch (error) {
    fail(`${config} is not valid JSON: ${error.message}`);
    return;
  }

  const shipped = new Set(
    [
      ...walk(
        'apps',
        (path) =>
          /(^|\/)i18n\/[a-z]{2}(-[A-Za-z]{2,4})?\.json$/.test(path) && !isGeneratedLocale(path),
      ),
    ]
      .map((path) => /([a-z]{2}(?:-[A-Za-z]{2,4})?)\.json$/.exec(path)?.[1])
      .filter((locale) => locale && !GENERATED_LOCALES.has(locale)),
  );

  const fallback = parsed['defaultLanguage'];
  const available = parsed['availableLanguages'];

  if (typeof fallback === 'string' && GENERATED_LOCALES.has(fallback)) {
    fail(
      `${config} ships \`defaultLanguage: "${fallback}"\`, which is the GENERATED pseudo-locale. ` +
        'It is produced on demand for auditing and is gitignored, so a customer install would ' +
        'render every string as accented placeholder text. Set it back to a real locale.',
    );
  } else if (typeof fallback === 'string' && shipped.size > 0 && !shipped.has(fallback)) {
    fail(
      `${config} ships \`defaultLanguage: "${fallback}"\` but no catalogue exists for it. ` +
        `Catalogues found: ${[...shipped].sort().join(', ')}.`,
    );
  }

  if (Array.isArray(available)) {
    for (const locale of available) {
      if (GENERATED_LOCALES.has(locale)) {
        fail(`${config} lists the generated pseudo-locale "${locale}" in availableLanguages.`);
      } else if (shipped.size > 0 && !shipped.has(locale)) {
        fail(
          `${config} advertises "${locale}" in availableLanguages but ships no catalogue for ` +
            'it, so choosing it would render the raw English fallback throughout.',
        );
      }
    }
    if (typeof fallback === 'string' && !available.includes(fallback)) {
      fail(
        `${config} ships \`defaultLanguage: "${fallback}"\` which is absent from ` +
          'availableLanguages, so the default is a language a user cannot switch back to.',
      );
    }
  }
}

/**
 * No hard-coded user-facing text inside a dialog's data object.
 *
 * ## Why this is its own check rather than a wider `checkNoHardcodedDescriptorText`
 *
 * `checkNoHardcodedUiText` is repo-wide but reads templates, and a dialog's title, message and
 * confirm label are built in TypeScript, so it never sees them.
 * `checkNoHardcodedDescriptorText` reads TypeScript but deliberately excludes `title` — that field
 * names a Nuxeo document property and a schema field at least as often as UI chrome, and there is a
 * control asserting it stays unflagged. Widening that check was tried during this work and the
 * control refused it, correctly: `browse.service.ts` builds a synthetic document with
 * `title: 'Root'`, and flagging that would be arguing with the reviewer on most hits.
 *
 * The difference is SCOPE, not the field list. Inside a `ConfirmDialogData` — or the `data:` of a
 * `MatDialog.open(...)` — `title` and `message` are unambiguously text a user reads. So this check
 * is anchored on the dialog context and can then afford to be strict about fields the other check
 * cannot touch at all.
 *
 * It is repo-wide, because 48 of these predate any diff and a diff-scoped version would certify
 * them by never looking.
 */
function checkNoHardcodedDialogText() {
  // All three literal forms, not just the single-quoted one.
  //
  // The first version of this check matched `'...'` only, and reported green over ten hard-coded
  // dialog messages written as template literals — including files the same commit had just keyed,
  // where `title` and `confirmLabel` were translated and `message` beside them was not. A gate that
  // watches two fields of an object and not the third is how that survived review twice.
  //
  // A template literal is the WORST form here, not an equivalent one: `Delete group "${name}"?`
  // is a concatenation, so even a translator who receives it cannot reorder the value, which
  // INFO-144 forbids outright.
  const FIELD =
    /\b(title|message|confirmLabel|cancelLabel|confirmText|cancelText)\s*:\s*('[A-Z][^']*'|"[A-Z][^"]*"|`[A-Z][^`]*`)/g;

  // Same exemptions as the template sweep, for the same reasons.
  const EXEMPT = [
    /^apps\/nuxeo-satori-template\//,
    /^libs\/extensions\/acme-extensions\//,
    /^libs\/core\//,
  ];

  /** The matching `}` for the `{` at `open`, or the end of the file. */
  const closingBrace = (text, open) => {
    let depth = 0;
    for (let at = open; at < text.length; at += 1) {
      if (text[at] === '{') depth += 1;
      else if (text[at] === '}') {
        depth -= 1;
        if (depth === 0) return at;
      }
    }
    return text.length;
  };

  /** The `{` opening the object that ends at `close`. */
  const openingBrace = (text, close) => {
    let depth = 0;
    for (let at = close; at >= 0; at -= 1) {
      if (text[at] === '}') depth += 1;
      else if (text[at] === '{') {
        depth -= 1;
        if (depth === 0) return at;
      }
    }
    return -1;
  };

  /**
   * Character ranges that are dialog DATA.
   *
   * Three shapes, all of them present in this repository: an object annotated
   * `as ConfirmDialogData`, the `data: { … }` of an `open(...)` call, and a function declared to
   * return a `*DialogData`.
   */
  const dialogRegions = (text) => {
    const spans = [];
    // `as ConfirmDialogData` follows its object, `: ConfirmDialogData` precedes it, and the first
    // version treated both the same way — it searched BACKWARD for a `}` from the annotation. For
    // `const data: ConfirmDialogData = { … }` that finds the end of whatever block came before the
    // declaration, so the object actually being annotated was never scanned.
    for (const m of text.matchAll(/\bas\s+\w*DialogData\b/g)) {
      const close = text.lastIndexOf('}', m.index);
      if (close === -1) continue;
      const open = openingBrace(text, close);
      if (open !== -1) spans.push([open, close]);
    }
    for (const m of text.matchAll(/:\s*\w*DialogData\s*=\s*\{/g)) {
      const open = text.indexOf('{', m.index);
      spans.push([open, closingBrace(text, open)]);
    }
    for (const m of text.matchAll(/\bdata:\s*\{/g)) {
      const open = text.indexOf('{', m.index);
      spans.push([open, closingBrace(text, open)]);
    }
    for (const m of text.matchAll(/\):\s*\w*DialogData\s*\{/g)) {
      const open = text.indexOf('{', m.index + m[0].length - 2);
      spans.push([open, closingBrace(text, open)]);
    }
    return spans;
  };

  const sources = [
    ...walk('apps', (path) => /\.ts$/.test(path)),
    ...walk('libs', (path) => /\.ts$/.test(path)),
  ].filter((path) => !/\.spec\.ts$/.test(path) && !EXEMPT.some((pattern) => pattern.test(path)));

  if (sources.length === 0) {
    fail('No TypeScript sources were found under apps/ or libs/, so this gate asserted nothing.');
    return;
  }

  const constants = proseStringConstants(sources);

  for (const file of sources) {
    const text = read(file);
    if (!/DialogData\b|\bdata:\s*\{/.test(text)) continue;
    const spans = dialogRegions(text);
    if (spans.length === 0) continue;

    const inDialog = (index) => spans.some(([open, close]) => open <= index && index <= close);

    // The same fields set through a ternary or a named constant, which `FIELD` cannot see because
    // it needs the literal straight after the colon: `title: isFolder ? 'Delete folder' : 'Delete
    // document'` and `message: DOMAIN_CONTAINER_GUIDANCE` are both hard-coded English.
    //
    // The value is read to its own top-level `,` or closing brace rather than to the end of the
    // line: Prettier breaks a long ternary across lines, and a line-bounded match let
    // `title: cond\n  ? 'Delete Reply'\n  : 'Delete Comment'` through on formatting alone.
    for (const match of text.matchAll(
      /\b(title|message|confirmLabel|cancelLabel|confirmText|cancelText)\s*:/g,
    )) {
      if (!inDialog(match.index)) continue;
      const value = topLevelText(text, match.index + match[0].length);
      if (!/\?/.test(value.replace(/(['"`])(?:\\.|(?!\1).)*\1/gs, ''))) continue;
      const branch = /(?:\?|:)\s*(['"`])([A-Z][^'"`]*)\1/.exec(value);
      if (!branch) continue;
      const line = text.slice(0, match.index).split('\n').length;
      fail(
        `${file}:${line} sets \`${match[1]}\` in a dialog's data from a ternary with the ` +
          `hard-coded branch \`${branch[2]}\`.\n` +
          "    Resolve each branch from the catalogue — `cond ? instant('x.a') : instant('x.b')` " +
          "— or select the key and resolve once: `instant(cond ? 'x.a' : 'x.b')`.",
      );
    }
    for (const match of text.matchAll(
      /\b(title|message|confirmLabel|cancelLabel|confirmText|cancelText)\s*:\s*([A-Z][A-Z0-9_]*)\s*[,}\n]/g,
    )) {
      if (!inDialog(match.index) || !constants.has(match[2])) continue;
      const line = text.slice(0, match.index).split('\n').length;
      fail(
        `${file}:${line} sets \`${match[1]}\` in a dialog's data to the constant \`${match[2]}\`, ` +
          `which holds the hard-coded English \`${constants.get(match[2])}\`.\n` +
          '    Make the constant a catalogue KEY and resolve it here with `translate.instant`.',
      );
    }

    for (const match of text.matchAll(FIELD)) {
      if (!inDialog(match.index)) continue;
      const line = text.slice(0, match.index).split('\n').length;
      const literal = match[2];
      const interpolated = literal.startsWith('`') && literal.includes('${');
      fail(
        `${file}:${line} sets \`${match[1]}: ${literal}\` in a dialog's data — user-facing ` +
          'text a user reads, built in TypeScript where no template pipe can reach it.\n' +
          (interpolated
            ? '    This one INTERPOLATES, so it is a concatenation as well as untranslated. A\n' +
              '    translator receiving the fragments cannot move the value, and it does not sit\n' +
              '    where English puts it in German or Japanese. INFO-144 forbids the shape, so the\n' +
              '    fix is one parameterised string rather than a lookup per fragment:\n' +
              `      ${match[1]}: this.translate.instant('confirm.delete-named', { name })\n` +
              '      en.json: \'Delete "{{ name }}"?\'\n'
            : "    Add a key to the owning project's `i18n/en.json` and resolve it at the call site:\n" +
              `      ${match[1]}: this.translate.instant('confirm.delete-document.${match[1]}')\n`) +
          '    A dialog is the one place `title` is unambiguously prose, which is why this gate ' +
          'can be strict about a field `checkNoHardcodedDescriptorText` must leave alone.',
      );
    }
  }
}

/**
 * A comment claiming a library has no dependency must be true of that library.
 *
 * `extension-actions.ts` documented that `libs/shared/extensions` "keeps no dependency on
 * ngx-translate". Two commits in this change-set then imported ngx-translate into that library —
 * the extension outlet's live region and `DescriptorLabelPipe` — and the sentence stayed. A
 * reviewer caught the second; the first had gone unremarked for several commits, because nothing
 * compares a documented guarantee against the imports beside it.
 *
 * So this check reads the claim and the imports in the same library and requires them to agree. It
 * does not forbid the dependency — that is an architectural decision, and the current answer is
 * that the FUNCTION is agnostic while the library's components are not. It forbids the two
 * disagreeing silently.
 */
function checkNoStaleAgnosticClaim() {
  const LIBRARY = 'libs/shared/extensions/src';
  // A STABLE MARKER, not a sentence.
  //
  // The first version of this gate matched the prose `this library keeps no dependency on
  // ngx-translate` — and the same commit that added the gate reworded that sentence, so the phrase
  // existed nowhere and the gate could never fire. I verified it "went red" by restoring the old
  // wording, which proved the regex worked rather than that it still matched the tree. A gate keyed
  // to prose dies the moment someone edits the prose, silently and in the direction of passing.
  const MARKER = '@i18n-contract:descriptor-api-is-framework-agnostic';

  // What the marker actually promises, now that the claim has been narrowed truthfully: the
  // descriptor API imposes no translation library on a CALLER. It does not promise the library has
  // no ngx-translate import — `extension-outlet.component.ts` and `descriptor-label.pipe.ts` both
  // have one, deliberately. So this asserts the thing that is true and load-bearing: that
  // `descriptorLabel` takes a resolver FUNCTION and does not reach for a service itself.
  const CONTRACT_FILE = `${LIBRARY}/lib/extension-actions.ts`;

  const sources = walk(LIBRARY, (path) => /\.ts$/.test(path)).filter(
    (path) => !/\.spec\.ts$/.test(path),
  );
  if (sources.length === 0) {
    fail(`No sources found under ${LIBRARY}, so this gate asserted nothing.`);
    return;
  }

  const claimants = sources.filter((file) => read(file).includes(MARKER));
  if (claimants.length === 0) {
    fail(
      `No file under ${LIBRARY} carries the \`${MARKER}\` marker, so this gate asserted nothing. ` +
        'The marker records a documented contract; if it was deleted, restore it beside the claim ' +
        'in extension-actions.ts rather than leaving this check inert.',
    );
    return;
  }

  const contract = read(CONTRACT_FILE);
  // `descriptorLabel(descriptor, translate)` — the second parameter is the resolver.
  const signature = /export function descriptorLabel\(([^)]*)\)/.exec(contract);
  if (!signature) {
    fail(
      `${CONTRACT_FILE} no longer declares \`descriptorLabel\`, so the contract the marker names ` +
        'cannot be checked. Update this gate together with whatever replaced it.',
    );
    return;
  }
  if (!/translate\s*:\s*\(/.test(signature[1])) {
    fail(
      `${CONTRACT_FILE} carries the \`${MARKER}\` marker, but \`descriptorLabel\` no longer takes a ` +
        'resolver function:\n' +
        `      (${signature[1].replace(/\s+/g, ' ').trim()})\n` +
        '    That marker promises the descriptor API imposes no translation library on a caller, ' +
        'which is exactly what the resolver parameter buys. Injecting a service here instead would ' +
        'push ngx-translate onto every consumer of Layer 1 descriptor data.',
    );
  }

  if (/inject\(\s*TranslateService\s*\)/.test(contract)) {
    fail(
      `${CONTRACT_FILE} injects TranslateService while carrying the \`${MARKER}\` marker. The ` +
        'descriptor contract is meant to take a resolver from its caller; a service here makes the ' +
        "choice of translation library this library's rather than the host's.",
    );
  }
}

/**
 * No hard-coded user-facing text built in TypeScript.
 *
 * ## The class eight review rounds could not see
 *
 * `checkNoHardcodedUiText` reads `.html`. `checkNoHardcodedDialogText` is scoped to a dialog's data.
 * `checkNoHardcodedDescriptorText` matches descriptor properties. A snackbar message, an error
 * signal and a toast fall through all three, and there are hundreds of them — every one shown to a
 * user, none reachable by any gate in the set. The pseudo-locale audit could not see them either,
 * because most are triggered by an action nobody performs during a route walk.
 *
 * That is why this pull request kept reporting itself complete: three checks agreed, and none of
 * them was looking at the place the strings live.
 *
 * ## What counts as a sink
 *
 * Only calls whose argument reaches the screen. `snackBar.open(message, action)` renders both.
 * `.error.set(...)`, `.statusMessage.set(...)` and friends are bound into templates as
 * `{{ error() }}`. A `console.log` or a thrown `Error` is not included: the first is invisible to a
 * user and the second is a developer diagnostic, and including them would make the check argue.
 *
 * Template literals are matched as well as quoted strings, because an interpolated message is a
 * concatenation and therefore worse than a plain one, not better.
 */
function checkNoHardcodedImperativeUiText() {
  /**
   * Names that hold text a template renders.
   *
   * The first version matched `error|status|message|...` as a PREFIX, which missed every signal
   * whose name ends in one — `recentlyEditedError`, `documentError`, `aiAnomalySummary`,
   * `referenceDataError`. That is the more common naming in this repository, so the check
   * substantiated far less than the count I quoted from it. Matched anywhere in the identifier now.
   */
  const SINK_NAME = /(?:error|status|message|notice|warning|summary|hint)/i;

  const SINKS = [
    // `snackBar.open('Saved.', 'OK')` — message and action label, both rendered. The literal is
    // matched ANYWHERE in the first argument, not only as the whole of it: the argument is often a
    // ternary, and `isPermissionDeniedError(err) ? DENIED : 'Failed to update collection'` had a
    // hard-coded branch the direct-argument form could not see.
    /\bsnackBar\s*\.\s*open\([\s\S]{0,300}?(['"`])([A-Z][^'"`]{2,})\1/g,
    // The action label, which is as visible as the message. `[^)]` cannot be used for the first
    // argument: once that argument is `this.translate.instant('x.k')` it contains its own
    // parentheses, and the pattern stopped short — so a resolved message with a literal label
    // read as clean, which is precisely the half-fixed state this check exists to catch.
    /\bsnackBar\s*\.\s*open\([\s\S]{0,400}?,\s*(['"])([A-Z][^'"]{1,40})\1\s*[,)]/g,
    // A signal or property holding user-visible status, bound as `{{ error() }}`. The name is
    // tested with `SINK_NAME`, so `documentError` and `aiAnomalySummary` count as well as `error`.
    // The literal is matched ANYWHERE in the argument, for the same reason as the snackbar above:
    // `agentsError.set(err?.error?.detail ?? 'Failed to load agents.')` puts a server message
    // first and the hard-coded fallback second, and the direct-argument form saw neither.
    // NOT case-insensitive. The `i` flag was added for the sink NAME and quietly made the
    // `[A-Z]` in the literal meaningless too, so the check started flagging the catalogue keys
    // it had just introduced. The name's capitalisation is spelled out in the class instead.
    /\.\s*(\w*(?:[Ee]rror|[Ss]tatus|[Mm]essage|[Nn]otice|[Ww]arning|[Ss]ummary|[Hh]int)\w*)\s*\.\s*set\((?:[^;]{0,200}?)(['"`])([A-Z][^'"`]{2,})\2/g,
  ];

  /**
   * Calls whose whole argument list reaches the screen, scanned by balanced parentheses rather
   * than by a regex window.
   *
   * `toast(` was matched as `toast\(\s*'…'`, so the literal had to be the first thing in the call,
   * and `toast(wasLocked ? 'Document unlocked' : 'Document locked')` — the most common shape in
   * the lock, favourite and subscribe handlers — passed. A regex window cannot stop at the call's
   * own closing parenthesis, so the argument is read by counting parentheses instead, skipping
   * string contents so a `(` inside a message cannot unbalance it.
   */
  const CALL_SINKS =
    /\b(?:toast|snackBar\s*\.\s*open|\w*(?:[Ee]rror|[Ss]tatus|[Mm]essage|[Nn]otice|[Ww]arning|[Ss]ummary|[Hh]int)\w*\s*\.\s*set)\s*\(/g;

  const EXEMPT = [
    /^apps\/nuxeo-satori-template\//,
    /^libs\/extensions\/acme-extensions\//,
    /^libs\/core\//,
  ];

  const sources = [
    ...walk('apps', (path) => /\.ts$/.test(path)),
    ...walk('libs', (path) => /\.ts$/.test(path)),
  ].filter((path) => !/\.spec\.ts$/.test(path) && !EXEMPT.some((p) => p.test(path)));

  if (sources.length === 0) {
    fail('No TypeScript sources found under apps/ or libs/, so this gate asserted nothing.');
    return;
  }

  const constants = proseStringConstants(sources);
  const reported = new Set();
  const report = (file, line, literal, via) => {
    const id = `${file}:${line}:${literal}`;
    if (reported.has(id)) return;
    reported.add(id);
    fail(
      `${file}:${line} passes the hard-coded string \`${literal}\`${via} to a user-facing sink — ` +
        'text a user reads, built in TypeScript where no template pipe can reach it.\n' +
        '    Add a key to the app catalogue and resolve it here:\n' +
        "      this.snackBar.open(this.translate.instant('x.saved'), this.translate.instant('common.ok'))\n" +
        '    A message assembled with `${…}` needs one parameterised key, not a lookup per ' +
        'fragment: a translator handed the pieces cannot reorder them.',
    );
  };

  for (const file of sources) {
    const text = read(file);
    if (!/snackBar|\.set\(|toast\(/.test(text)) continue;

    for (const call of text.matchAll(CALL_SINKS)) {
      const open = call.index + call[0].length - 1;
      const argument = balancedArgument(text, open);
      const line = text.slice(0, call.index).split('\n').length;
      // The literal as the whole first argument — `toast('Document restored.')`.
      const direct = /^\s*(['"`])([A-Z][^'"`]{2,})\1/.exec(argument);
      if (direct) report(file, line, direct[2], '');
      // Each branch of a ternary, and a `??` / `||` fallback: a literal that follows `?`, `:`,
      // `??` or `||`. A literal handed to a nested call — `instant('x.k')`, `captureError('Op')` —
      // or compared against — `startsWith('Cannot sort by')` — follows `(` or `,`, so it is not.
      for (const m of argument.matchAll(/(?:\?\??|:|\|\|)\s*(['"`])([A-Z][^'"`]{2,})\1/g)) {
        report(file, line, m[2], '');
      }
      // A module constant holding prose, named rather than written inline.
      for (const [name, value] of constants) {
        if (new RegExp(`(?<![\\w.'"])${escapeRegExp(name)}(?![\\w(])`).test(argument)) {
          report(file, line, value, ` (through the constant \`${name}\`)`);
        }
      }
    }

    // A local `const` holding prose, passed to a sink later in the same block:
    //
    //   const msg = err?.error?.message || 'Failed to delegate task.';
    //   this.snackBar.open(msg, …);
    //
    // Scoped to the declaring block, so a same-named `msg` in another method is not blamed for it.
    for (const decl of text.matchAll(/\bconst\s+([a-z_$][\w$]*)\s*(?::\s*string\s*)?=/g)) {
      const valueStart = decl.index + decl[0].length;
      const value = statementText(text, valueStart);
      const literal =
        /^\s*(['"`])([A-Z][^'"`]{2,})\1\s*$/.exec(value) ??
        /(?:\?\??|:|\|\|)\s*(['"`])([A-Z][^'"`]{2,})\1/.exec(value);
      if (!literal || !/\s/.test(literal[2])) continue;
      const blockEnd = enclosingBlockEnd(text, valueStart);
      const uses = new RegExp(`(?<![\\w.'"])${escapeRegExp(decl[1])}(?![\\w(])`);
      for (const call of text.slice(valueStart, blockEnd).matchAll(CALL_SINKS)) {
        const at = valueStart + call.index;
        const argument = balancedArgument(text, at + call[0].length - 1);
        if (!uses.test(argument)) continue;
        const line = text.slice(0, at).split('\n').length;
        report(file, line, literal[2], ` (through the local \`${decl[1]}\`)`);
      }
    }

    for (const sink of SINKS) {
      for (const match of text.matchAll(sink)) {
        // The signal pattern captures the NAME first, so the literal is the last group either way.
        const literal = match[match.length - 1];
        if (match.length === 4 && !SINK_NAME.test(match[1])) continue;

        // Matching anywhere in the argument is what lets the ternary and `??` fallbacks be seen, and
        // it costs two false positives that have to be excluded precisely:
        //
        //   agentsErrorDetail.set(this.captureError('HylandKnowledgeDiscovery.getAllAgents', err))
        //   error.set(message.startsWith('Cannot sort by') ? message : '…')
        //
        // The first is an operation name handed to a NESTED call; the second is a comparison. The
        // exclusion looks only at the ARGUMENT text — between the sink's own `(` and the literal —
        // because an earlier version tested the whole match and so excluded `set('…')` itself, which
        // silently switched the check off for the plainest shape it exists to catch.
        const whole = match[0];
        const openParen = whole.indexOf('(');
        const quotedAt = whole.lastIndexOf(literal);
        const argumentPrefix = whole.slice(openParen + 1, quotedAt).replace(/['"`]\s*$/, '');
        if (/\w\s*\(\s*$/.test(argumentPrefix)) continue;
        if (/[=!]==?\s*$/.test(argumentPrefix)) continue;

        const line = text.slice(0, match.index).split('\n').length;
        report(file, line, literal, '');
      }
    }
  }
}

/**
 * The text between the `(` at `open` and its matching `)`, with quoted contents kept intact.
 *
 * Quotes are tracked so a parenthesis inside a message — `'Failed (retry later)'` — cannot end
 * the argument early. A `${…}` inside a template literal is not tracked; no sink argument in this
 * repository nests a call inside one, and the failure would be to stop early, not to over-read.
 */
function balancedArgument(text, open) {
  let depth = 0;
  let quote = null;
  for (let at = open; at < text.length; at += 1) {
    const ch = text[at];
    if (quote) {
      if (ch === '\\') at += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, at);
    }
  }
  return text.slice(open + 1);
}

/**
 * The text of a property value starting at `from`, up to its own top-level `,` or the brace or
 * parenthesis that closes the enclosing object. Nested brackets and quoted strings are skipped
 * whole, so a comma inside `instant('k', { a, b })` does not end the value early.
 */
function topLevelText(text, from) {
  let depth = 0;
  let quote = null;
  for (let at = from; at < text.length; at += 1) {
    const ch = text[at];
    if (quote) {
      if (ch === '\\') at += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') {
      if (depth === 0) return text.slice(from, at);
      depth -= 1;
    } else if (ch === ',' && depth === 0) return text.slice(from, at);
  }
  return text.slice(from);
}

/** `text` with every regular-expression metacharacter escaped, for building a pattern from it. */
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The text of a statement starting at `from`, up to its own top-level `;` or line-ending brace. */
function statementText(text, from) {
  let depth = 0;
  let quote = null;
  for (let at = from; at < text.length; at += 1) {
    const ch = text[at];
    if (quote) {
      if (ch === '\\') at += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') {
      if (depth === 0) return text.slice(from, at);
      depth -= 1;
    } else if (ch === ';' && depth === 0) return text.slice(from, at);
  }
  return text.slice(from);
}

/** The index of the `}` closing the block that contains `from`, or the end of the text. */
function enclosingBlockEnd(text, from) {
  let depth = 0;
  let quote = null;
  for (let at = from; at < text.length; at += 1) {
    const ch = text[at];
    if (quote) {
      if (ch === '\\') at += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      if (depth === 0) return at;
      depth -= 1;
    }
  }
  return text.length;
}

/**
 * `const NAME = 'Some prose.'` declarations across the given sources, as `[name, value]` pairs.
 *
 * Prose means capitalised and at least two words — `'Open Sections, Templates, or Workspaces,
 * then…'` — so a key (`'common.ok'`), an operation name (`'Document.Lock'`) or a single enum-ish
 * word is not collected. This is what lets a sink check see `toast(CREATABLE_SUBTYPES_NOTICE)`:
 * the literal was declared once in a shared library and passed by name in five places, and every
 * gate that looked for a literal at the call site read all five as clean.
 *
 * SCREAMING_CASE names only. The lookup is repo-wide, and a local `const message = 'Saved.'` in
 * one file would otherwise match every `message` identifier in every other file. Backtick
 * literals count as well as quoted ones; an interpolated one is still prose.
 */
function proseStringConstants(sources) {
  const found = new Map();
  for (const file of sources) {
    const text = read(file);
    for (const m of text.matchAll(
      /\bconst\s+([A-Z][A-Z0-9_]*)\s*(?::\s*string\s*)?=\s*(['"`])([A-Z][^'"`\n]*\s[^'"`\n]*)\2\s*;/g,
    )) {
      found.set(m[1], m[3]);
    }
  }
  return found;
}

/**
 * A catalogue value must be the text a user sees.
 *
 * Two defects this caught, both shipped:
 *
 * `"Back to Users &amp; Groups"` — the extraction codemod copied the HTML SOURCE of a text node into
 * JSON. In HTML the browser decodes `&amp;`; through `{{ … | translate }}` Angular sets
 * `textContent` and does not, so the user read the literal characters `&amp;`. Four values, on the
 * Users & Groups heading and two back-links. The codemod's own docstring claimed byte-identical
 * source keeps the rendered DOM unchanged — true only while the text stays in an HTML text node.
 *
 * `"Choose file(s)"` — an `(s)` suffix assumes a language pluralises by appending one letter. This
 * branch removed that shape from three other places and then created a new one in the catalogue,
 * where nothing was looking.
 */
function checkCatalogueValuesAreRenderable() {
  const ENTITY = /&(?:[a-zA-Z]+|#\d+);/;
  const PLURAL_SUFFIX = /\(s\)/;

  const isCatalogue = (path) =>
    /(^|\/)i18n\/[a-z]{2}(-[A-Za-z]{2,4})?\.json$/.test(path) && !isGeneratedLocale(path);
  const catalogues = [...walk('apps', isCatalogue), ...walk('libs', isCatalogue)].filter(
    (path) => !/^apps\/nuxeo-satori-template\//.test(path),
  );
  if (catalogues.length === 0) {
    fail('No catalogues were found, so this gate asserted nothing.');
    return;
  }

  for (const file of catalogues) {
    let parsed;
    try {
      parsed = JSON.parse(read(file));
    } catch {
      continue; // checkTranslationCatalogues reports malformed JSON, and names the file.
    }
    // A local flattener: `checkTranslationCatalogues` has one, but it is scoped inside that check
    // and carries diagnostics this gate does not want.
    const entries = [];
    const collect = (node, prefix) => {
      for (const [key, value] of Object.entries(node)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (value && typeof value === 'object') collect(value, path);
        else entries.push([path, value]);
      }
    };
    collect(parsed, '');

    for (const [key, value] of entries) {
      if (typeof value !== 'string') continue;
      if (ENTITY.test(value)) {
        fail(
          `${file} maps \`${key}\` to "${value}", which contains an HTML character reference. ` +
            'Interpolation sets `textContent`, so the user reads the reference itself rather than ' +
            'the character it stands for. Store the decoded character.',
        );
      }
      if (PLURAL_SUFFIX.test(value)) {
        fail(
          `${file} maps \`${key}\` to "${value}", which pluralises with an \`(s)\` suffix. That ` +
            'assumes a language forms its plural by appending one letter, and most do not. Use a ' +
            'key per grammatical number, chosen by a branch at the call site.',
        );
      }
    }
  }
}

/**
 * A class that uses `this.translate` must actually inject it.
 *
 * Five classes reached CI using `this.translate.instant(...)` with no
 * `translate = inject(TranslateService)` — a runtime crash on the first error path, not a compile
 * error, because `this.translate` on a class with an index signature or a loose `any` in the chain
 * type-checks fine. `nx typecheck` was green; three Knowledge Discovery specs failed with
 * `expected null` because the error callback threw before it could set anything.
 *
 * `bulk-action.services.ts` showed the variant: one file, six classes, and a bulk edit that injected
 * into the first only. So this counts per CLASS, not per file.
 */
function checkTranslateIsInjectedWhereUsed() {
  const sources = [
    ...walk('apps', (path) => /\.ts$/.test(path)),
    ...walk('libs', (path) => /\.ts$/.test(path)),
  ].filter((path) => !/\.spec\.ts$/.test(path));

  if (sources.length === 0) {
    fail('No TypeScript sources found under apps/ or libs/, so this gate asserted nothing.');
    return;
  }

  for (const file of sources) {
    const text = read(file);
    if (!text.includes('this.translate.')) continue;

    // Split on class boundaries so a file with several classes is judged class by class.
    const classes = [...text.matchAll(/(?:export\s+)?class\s+(\w+)[^{]*\{/g)];
    if (classes.length === 0) continue;
    for (let at = 0; at < classes.length; at += 1) {
      const start = classes[at].index;
      const end = at + 1 < classes.length ? classes[at + 1].index : text.length;
      const body = text.slice(start, end);
      if (!body.includes('this.translate.')) continue;
      if (/\btranslate\s*=\s*inject\(\s*TranslateService\s*\)/.test(body)) continue;
      const line = text.slice(0, start).split('\n').length;
      fail(
        `${file}:${line} class \`${classes[at][1]}\` uses \`this.translate\` but never injects it.\n` +
          '    Add `private readonly translate = inject(TranslateService);` to THIS class. A bulk ' +
          'edit that injects into the first class in a file leaves the rest crashing on their first ' +
          'error path, and `typecheck` does not catch it — only a spec that exercises that path does.',
      );
    }
  }
}

/* ---------------- libs/shared/satori-components (NXSAT-308) ---------------- */

/**
 * The `nxs-` component library, published as `@nuxeo-satori/platform/components`.
 *
 * Three rules hold it to the plan of record (`satori_component_library` plan, sections 3 and 7):
 * it builds and ships with no ADF, no HxCS client and no Satori, because Satori is to enter only
 * through a separate `/components-satori` entry point — so that once Satori is an optional peer of
 * the package, a customer without GitHub Packages access still gets the Material implementations; it is reached only through its entry point; and
 * it stays cheap to turn into a federated remote later.
 */
const SATORI_COMPONENTS_ROOT = 'libs/shared/satori-components';
const SATORI_COMPONENTS_ENTRY = '@nuxeo-satori/platform/components';
const SATORI_COMPONENTS_BARREL = `${SATORI_COMPONENTS_ROOT}/src/index.ts`;

/**
 * `@nuxeo-satori/platform/components-satori`: the same primitive IDs re-registered on Satori, and
 * the one place in the library family allowed to import `@hylandsoftware/satori-ui` (plan section 3).
 * Its own project, so the base library's no-Satori rule needs no exception carved into it.
 */
const SATORI_FALLBACK_ROOT = 'libs/shared/satori-components-satori';
const SATORI_FALLBACK_ENTRY = '@nuxeo-satori/platform/components-satori';
const SATORI_FALLBACK_BARREL = `${SATORI_FALLBACK_ROOT}/src/index.ts`;

/** Each library in the family, with its entry point and the `ng-package.json` that publishes it. */
const SATORI_LIBRARIES = [
  {
    root: SATORI_COMPONENTS_ROOT,
    entry: SATORI_COMPONENTS_ENTRY,
    barrel: SATORI_COMPONENTS_BARREL,
    ngPackage: 'libs/platform/components/ng-package.json',
  },
  {
    root: SATORI_FALLBACK_ROOT,
    entry: SATORI_FALLBACK_ENTRY,
    barrel: SATORI_FALLBACK_BARREL,
    ngPackage: 'libs/platform/components-satori/ng-package.json',
  },
];

const isTsconfig = (path) => /(^|\/)tsconfig[^/]*\.json$/.test(path);

/**
 * `paths`, `baseUrl` and the config that declared `paths`, as TypeScript computes them for one
 * config: its own values, else the nearest inherited ones. `baseUrl` is resolved against the
 * config that sets it. Only relative `extends` are followed — a package config is not ours.
 */
function effectiveCompilerPaths(config, seen = new Set()) {
  if (seen.has(config) || !fileExists(config)) return {};
  const parsed = ts.parseConfigFileTextToJson(config, read(config)).config ?? {};
  let effective = {};
  for (const parent of [parsed.extends ?? []].flat()) {
    if (typeof parent !== 'string' || !parent.startsWith('.')) continue;
    const file = toPosixRel(
      join(dirname(config), parent.endsWith('.json') ? parent : `${parent}.json`),
    );
    effective = { ...effective, ...effectiveCompilerPaths(file, new Set([...seen, config])) };
  }
  const options = parsed.compilerOptions ?? {};
  if (typeof options.baseUrl === 'string') {
    effective.baseUrl = toPosixRel(join(dirname(config), options.baseUrl));
  }
  if (options.paths && typeof options.paths === 'object') {
    effective.paths = options.paths;
    effective.declaredIn = config;
  }
  return effective;
}

/**
 * Every `paths` map a compilation in this repository sees, its targets made repo-relative.
 *
 * Not only `tsconfig.base.json`'s: a project's own tsconfig may declare `paths`, which replaces the
 * inherited map for that project, and an alias declared there is as real as one in the base.
 * Targets resolve against the effective `baseUrl`, or with none against the directory of the
 * config that declared `paths`; `${configDir}` is the config being compiled.
 */
function tsconfigPathMaps() {
  const configs = [
    ...readdirSync(repoRoot).filter(isTsconfig),
    ...walk('apps', isTsconfig),
    ...walk('libs', isTsconfig),
  ];
  const maps = new Map();
  for (const config of configs) {
    const { paths, baseUrl, declaredIn } = effectiveCompilerPaths(config);
    if (!paths) continue;
    const from = baseUrl ?? dirname(declaredIn);
    const usesConfigDir = JSON.stringify(paths).includes('${configDir}');
    const key = `${declaredIn}|${from}|${usesConfigDir ? config : ''}`;
    if (maps.has(key)) continue;
    const rebase = (target) =>
      target.startsWith('${configDir}')
        ? toPosixRel(join(dirname(config), target.slice('${configDir}'.length).replace(/^\//, '')))
        : toPosixRel(join(from, target));
    maps.set(key, {
      declaredIn,
      paths: Object.fromEntries(
        Object.entries(paths).map(([alias, targets]) => [
          alias,
          (Array.isArray(targets) ? targets : []).map(rebase),
        ]),
      ),
    });
  }
  return [...maps.values()];
}

/** The first file a list of targets resolves to, as TypeScript tries them, or `null`. */
function firstExistingTarget(targets) {
  for (const target of targets) {
    const base = toPosixRel(join(target)).replace(/^\.\//, '');
    // TypeScript maps an explicit `.js`/`.mjs` specifier back to its `.ts`/`.mts` source.
    const source = base.replace(/\.js$/, '.ts').replace(/\.mjs$/, '.mts');
    for (const candidate of [source, base, `${base}.ts`, `${base}.mts`, `${base}/index.ts`]) {
      if (fileExists(candidate) && statSync(join(repoRoot, candidate)).isFile()) return candidate;
    }
  }
  return null;
}

/**
 * The repo-relative files a specifier resolves to — `[]` if it names no file, `undefined` if it is
 * neither relative nor matched by any alias, so a package.
 *
 * Every alias in every map is tried, not only the one TypeScript would pick for `fromFile`:
 * over-approximating what a file can reach adds files to a walk and never hides one.
 */
function resolveSpecifier(fromFile, specifier, pathMaps) {
  if (specifier.startsWith('.')) {
    const hit = firstExistingTarget([toPosixRel(join(dirname(fromFile), specifier))]);
    return hit ? [hit] : [];
  }
  let matched = false;
  const out = new Set();
  for (const { paths } of pathMaps) {
    for (const [alias, aliasTargets] of Object.entries(paths)) {
      let targets = aliasTargets;
      if (alias !== specifier) {
        const star = alias.indexOf('*');
        if (star === -1) continue;
        const [prefix, suffix] = [alias.slice(0, star), alias.slice(star + 1)];
        if (
          specifier.length < prefix.length + suffix.length ||
          !specifier.startsWith(prefix) ||
          !specifier.endsWith(suffix)
        ) {
          continue;
        }
        const middle = specifier.slice(prefix.length, specifier.length - suffix.length);
        targets = aliasTargets.map((target) => target.replaceAll('*', middle));
      }
      matched = true;
      const hit = firstExistingTarget(targets);
      if (hit) out.add(hit);
    }
  }
  return matched ? [...out] : undefined;
}

/** Every module specifier in a source file, type-only and dynamic imports included. */
function importSpecifiers(text) {
  return ts.preProcessFile(text, true, true).importedFiles.map((entry) => entry.fileName);
}

/**
 * A decorator's `@angular/core` name, so `import { Component as C }` and `import * as ng`
 * classify the same as a plain `@Component`.
 */
function angularDecoratorNamer(source) {
  const names = new Map();
  const namespaces = new Set();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (statement.moduleSpecifier.text !== '@angular/core') continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings) continue;
    if (ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
    else {
      for (const element of bindings.elements) {
        names.set(element.name.text, (element.propertyName ?? element.name).text);
      }
    }
  }
  return (callee) => {
    if (ts.isIdentifier(callee)) return names.get(callee.text) ?? callee.text;
    if (
      ts.isPropertyAccessExpression(callee) &&
      ts.isIdentifier(callee.expression) &&
      namespaces.has(callee.expression.text)
    ) {
      return callee.name.text;
    }
    return callee.getText(source);
  };
}

/**
 * A metadata key by name, however it is spelled: `providedIn`, `'providedIn'` and
 * `['providedIn']` are one key to Angular, so they are one key here.
 */
function metadataKey(property, source) {
  const name = property.name;
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
  if (ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression)) {
    return name.expression.text;
  }
  return name.getText(source);
}

const STYLE_KEYS = new Set(['styleUrl', 'styleUrls', 'styles']);

/**
 * The stylesheets a file's decorators name: `styleUrl` / `styleUrls` paths and inline `styles`.
 *
 * Read from the syntax tree, not matched by pattern, because every spelling a pattern missed was a
 * stylesheet never opened: a quoted or computed key, a backtick path. What cannot be read
 * statically — a constant, an interpolated template, `@Component` metadata that is not an object
 * literal or spreads one in — is returned as `unreadable`, so the caller fails rather than passing
 * a stylesheet it never saw.
 */
function stylesOf(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const lineOf = (node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const decoratorName = angularDecoratorNamer(source);
  const out = { files: [], inline: [], unreadable: [] };
  const visit = (node) => {
    if (ts.isDecorator(node) && ts.isCallExpression(node.expression)) {
      const isComponent = decoratorName(node.expression.expression) === 'Component';
      const [metadata] = node.expression.arguments;
      if (metadata && !ts.isObjectLiteralExpression(metadata) && isComponent) {
        out.unreadable.push({ line: lineOf(metadata), key: null });
      }
      for (const property of metadata && ts.isObjectLiteralExpression(metadata)
        ? metadata.properties
        : []) {
        if (ts.isSpreadAssignment(property)) {
          if (isComponent) out.unreadable.push({ line: lineOf(property), key: null });
          continue;
        }
        const key = metadataKey(property, source);
        if (!STYLE_KEYS.has(key)) continue;
        const value = ts.isPropertyAssignment(property) ? property.initializer : undefined;
        const items = value && ts.isArrayLiteralExpression(value) ? value.elements : [value];
        for (const item of items) {
          if (!item || !ts.isStringLiteralLike(item)) {
            out.unreadable.push({ line: lineOf(property), key });
          } else if (key === 'styles') {
            out.inline.push(item.text);
          } else {
            out.files.push(toPosixRel(join(dirname(file), item.text)));
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

/**
 * The files a local Sass URL can load, in Sass's own order: the file, its `_` partial, then the
 * directory's `index` or `_index` — each as `.scss` or `.sass`. A URL with a Sass extension names
 * the file and its partial only; a `.css` URL names that file, which Sass leaves as a CSS `@import`
 * and the application build then follows.
 */
function sassCandidates(base) {
  const dir = dirname(base);
  const name = base.split('/').pop();
  if (/\.css$/.test(name)) return [base];
  if (/\.(scss|sass)$/.test(name)) return [base, toPosixRel(join(dir, `_${name}`))];
  return [
    ...['scss', 'sass'].flatMap((ext) => [
      `${base}.${ext}`,
      toPosixRel(join(dir, `_${name}.${ext}`)),
    ]),
    ...['scss', 'sass'].flatMap((ext) => [`${base}/index.${ext}`, `${base}/_index.${ext}`]),
  ];
}

/**
 * Every URL a stylesheet loads: `@use` and `@forward` (one URL each — a later string is
 * configuration), every entry of an `@import` list, quoted or as `url(…)`, and `meta.load-css()`.
 *
 * Indented Sass (`indented`) ends a rule at the end of its line rather than at `;`, and may write
 * an `@import` list unquoted.
 */
function sassLoadedUrls(body, { indented = false } = {}) {
  const urls = [];
  const rules = indented
    ? /@(use|forward|import)[ \t]+([^\n]*)/g
    : /@(use|forward|import)\s+([^;{}]*)/g;
  for (const rule of body.matchAll(rules)) {
    let strings = [...rule[2].matchAll(/['"]([^'"]+)['"]|url\(\s*([^'"()\s]+)\s*\)/g)].map(
      (match) => match[1] ?? match[2],
    );
    if (indented && rule[1] === 'import' && strings.length === 0) {
      strings = rule[2]
        .split(',')
        .map((url) => url.trim())
        .filter(Boolean);
    }
    urls.push(...(rule[1] === 'import' ? strings : strings.slice(0, 1)));
  }
  for (const call of body.matchAll(/load-css\(\s*['"]([^'"]+)['"]/g)) urls.push(call[1]);
  return urls;
}

function satoriComponentsSources() {
  return walk(`${SATORI_COMPONENTS_ROOT}/src`, (path) => /\.(ts|mts)$/.test(path));
}

const SATORI_COMPONENTS_STORYBOOK = `${SATORI_COMPONENTS_ROOT}/.storybook`;
const SATORI_COMPONENTS_PROJECT = `${SATORI_COMPONENTS_ROOT}/project.json`;

/** The one Storybook stylesheet that may reach Satori: the opt-in `:satori` configuration's theme. */
const SATORI_COMPONENTS_STORYBOOK_SATORI_THEME = `${SATORI_COMPONENTS_STORYBOOK}/satori-theme.scss`;

/**
 * The Storybook stylesheets held to the no-Satori rule: everything any `build-storybook`
 * configuration names, and every stylesheet under `.storybook/` — all but the opt-in `:satori`
 * configuration's theme.
 *
 * The exception is exact. Named by the default or any other configuration, that theme is checked
 * like the rest, and anything else the `:satori` configuration names is checked too. Every entry,
 * whatever its extension — Angular compiles `.css` and indented `.sass` as well as `.scss`. An
 * unreadable project.json still leaves the `.storybook/` stylesheets and the library sources.
 */
function satoriComponentsStorybookStyles() {
  const entries = (styles) =>
    (Array.isArray(styles) ? styles : [])
      .map((style) => (typeof style === 'string' ? style : style?.input))
      .filter((style) => typeof style === 'string');
  let target = {};
  if (fileExists(SATORI_COMPONENTS_PROJECT)) {
    try {
      target = JSON.parse(read(SATORI_COMPONENTS_PROJECT)).targets?.['build-storybook'] ?? {};
    } catch {
      target = {};
    }
  }
  const tokenFree = [
    ...entries(target.options?.styles),
    ...Object.entries(target.configurations ?? {})
      .filter(([name]) => name !== 'satori')
      .flatMap(([, configuration]) => entries(configuration?.styles)),
  ];
  const optIn = entries(target.configurations?.satori?.styles);
  const onDisk = walk(SATORI_COMPONENTS_STORYBOOK, (path) => /\.(s?css|sass)$/.test(path));
  const exempt = tokenFree.includes(SATORI_COMPONENTS_STORYBOOK_SATORI_THEME)
    ? null
    : SATORI_COMPONENTS_STORYBOOK_SATORI_THEME;
  return [...new Set([...tokenFree, ...optIn, ...onDisk])].filter((style) => style !== exempt);
}

/**
 * No `@alfresco/*`, no `@hylandsoftware/*` — reached directly **or through anything it imports**.
 *
 * Transitive on purpose. `libs/shared/nuxeo-client` once imported a Satori type in `avatar-colors.ts`
 * and `libs/shared/extensions` imported `@alfresco/adf-extensions`, so a component importing either
 * barrel needed both packages to compile while a direct-import check stayed green. A type-only
 * import counts: it still needs the package installed to compile. The ban is on the specifier, so
 * a tsconfig alias that maps a banned name to a workspace file does not lift it — the emitted code
 * still names the package. Stylesheets count too, because
 * `@use '@hylandsoftware/satori-ui/theme'` needs the package as much as an import does, and so do
 * inline `styles`, which the app compiles as SCSS.
 *
 * The Storybook build is held to the same rule, because it has to build without a token (plan
 * section 9.4): `.storybook/*.ts` are roots, and so is every stylesheet a `build-storybook`
 * configuration names or `.storybook/` holds, except the opt-in `:satori` configuration's theme.
 */
function checkSatoriComponentsDependencies() {
  const sources = satoriComponentsSources();
  if (sources.length === 0) {
    fail(
      `${SATORI_COMPONENTS_ROOT} has no TypeScript sources, so the no-ADF / no-Satori rule for ` +
        'the component library asserted nothing.',
    );
    return;
  }
  checkDependencyClosure({
    root: SATORI_COMPONENTS_ROOT,
    roots: [...sources, ...walk(SATORI_COMPONENTS_STORYBOOK, (path) => /\.(ts|mts)$/.test(path))],
    styleRoots: satoriComponentsStorybookStyles(),
    banned: (specifier) => {
      const common = bannedForSatoriLibraries(specifier);
      if (common) return common;
      if (/^@hylandsoftware\//.test(specifier)) {
        return (
          'Satori may enter only through a separate `/components-satori` entry point, so this ' +
          'library never needs the Satori package itself'
        );
      }
      return null;
    },
  });
}

/** ADF and the HxCS client are out of the whole library family, the Satori entry point included. */
function bannedForSatoriLibraries(specifier) {
  if (/^@alfresco\//.test(specifier)) {
    return 'ADF leaves the dependency tree in NXSAT-308, and nothing new may be built on it';
  }
  if (/^@hylandsoftware\/hxcs-js-client(\/|$)/.test(specifier)) {
    return 'the HxCS client exists only for the adf-hx bridge and leaves with it';
  }
  return null;
}

/**
 * `/components-satori` may import `@hylandsoftware/satori-ui` — exactly that package, and only here.
 *
 * It is the package's one optional peer from GitHub Packages, so nothing else from that registry
 * may enter even through this library: `satori-tokens` or `satori-icons` imported directly would be
 * a second, undeclared dependency a customer's install could not satisfy. Followed transitively,
 * like the base library's rule, so it also holds for anything this library reaches.
 */
function checkSatoriFallbackDependencies() {
  const sources = walk(`${SATORI_FALLBACK_ROOT}/src`, (path) => /\.(ts|mts)$/.test(path));
  if (sources.length === 0) {
    fail(
      `${SATORI_FALLBACK_ROOT} has no TypeScript sources, so the rule that it alone may import ` +
        '`@hylandsoftware/satori-ui` asserted nothing.',
    );
    return;
  }
  checkDependencyClosure({
    root: SATORI_FALLBACK_ROOT,
    roots: sources,
    banned: (specifier) => {
      const common = bannedForSatoriLibraries(specifier);
      if (common) return common;
      if (/^@hylandsoftware\/satori-ui(\/|$)/.test(specifier)) return null;
      if (/^@hylandsoftware\//.test(specifier)) {
        return (
          'only `@hylandsoftware/satori-ui` is a peer of the package, and an optional one, so ' +
          'nothing else from GitHub Packages may enter, even here'
        );
      }
      return null;
    },
  });
}

/**
 * Walk every import, stylesheet `@use` and component `styleUrl` reachable from `roots`, through
 * workspace aliases and relative paths, and fail each external specifier `banned` names a reason for.
 */
function checkDependencyClosure({ root, roots, styleRoots = [], banned }) {
  const pathMaps = tsconfigPathMaps();
  const reportedFor = new Set();
  const project = `${root}/project.json`;
  // One report per offending import, however many library files reach it.
  const report = (chain, specifier, why) => {
    const holder = chain[chain.length - 1];
    const key = `${holder}|${specifier}`;
    if (reportedFor.has(key)) return;
    reportedFor.add(key);
    const outside = !holder.startsWith(`${root}/`);
    fail(
      `${holder} imports \`${specifier}\`` +
        (outside ? `, and the library reaches that file through ${chain.join(' -> ')}` : '') +
        `. ${root} may not depend on it: ${why}.` +
        (outside
          ? '\n    The import is not in the library itself — move what you need behind a ' +
            'boundary that does not carry the package, or remove the package from that file.'
          : ''),
    );
  };

  // `label` names the stylesheet in a report; `at` is where its relative URLs resolve from.
  const scanStyleText = (body, at, label, chain, seen) => {
    for (const url of sassLoadedUrls(body, { indented: at.endsWith('.sass') })) {
      // `~` is webpack's package prefix and `pkg:` Sass's; either way the URL names a package.
      const why = banned(url.replace(/^~/, '').replace(/^pkg:/, ''));
      if (why) {
        report([...chain, label], url, why);
        continue;
      }
      // Sass resolves a bare URL (`@use 'theme'`) against the current file first, like `./theme`.
      // A package URL starts with `@` or `~`; `sass:`, `pkg:` and any other scheme are not files.
      if (/^[@~]|^[a-z][a-z0-9+.-]*:/i.test(url)) continue;
      const base = toPosixRel(join(dirname(at), url));
      const found = sassCandidates(base).find(
        (candidate) => fileExists(candidate) && statSync(join(repoRoot, candidate)).isFile(),
      );
      if (found) scanStyles(found, [...chain, label], seen);
    }
  };
  const scanStyles = (styleFile, chain, seen) => {
    if (seen.has(styleFile) || !fileExists(styleFile)) return;
    seen.add(styleFile);
    scanStyleText(read(styleFile), styleFile, styleFile, chain, seen);
  };

  const storybookStyles = new Set();
  for (const styleFile of styleRoots) {
    if (!fileExists(styleFile)) {
      fail(
        `${project} names \`${styleFile}\` in build-storybook's styles, and it ` +
          'does not exist, so the token-free Storybook theme was not checked.',
      );
      continue;
    }
    scanStyles(styleFile, [project], storybookStyles);
  }

  for (const root of roots) {
    const seen = new Set();
    const styles = new Set();
    const queue = [[root]];
    while (queue.length > 0) {
      const chain = queue.shift();
      const file = chain[chain.length - 1];
      if (seen.has(file)) continue;
      seen.add(file);
      const text = read(file);
      const sheets = stylesOf(file, text);
      for (const { line, key } of sheets.unreadable) {
        const where = `${file}:${line}`;
        if (reportedFor.has(where)) continue;
        reportedFor.add(where);
        fail(
          key
            ? `${where} \`${key}\` is not a string literal, so the stylesheet it names was not ` +
                `checked for ADF or Satori. Write it as a literal.`
            : `${where} @Component metadata is not an object literal the guardrail can read — a ` +
                'constant, or a spread — so its stylesheets were not checked for ADF or Satori. ' +
                'Write the metadata inline.',
        );
      }
      for (const styleFile of sheets.files) scanStyles(styleFile, chain, styles);
      for (const css of sheets.inline) {
        scanStyleText(css, file, `${file} (inline styles)`, chain.slice(0, -1), styles);
      }
      for (const specifier of importSpecifiers(text)) {
        const why = banned(specifier);
        if (why) {
          report(chain, specifier, why);
          continue;
        }
        for (const resolved of resolveSpecifier(file, specifier, pathMaps) ?? []) {
          if (!seen.has(resolved)) queue.push([...chain, resolved]);
        }
      }
    }
  }
}

/**
 * Each library is reached through its entry point and nothing else —
 * `@nuxeo-satori/platform/components`, and `@nuxeo-satori/platform/components-satori`.
 *
 * A deep import into a library cannot be versioned — the reason the customer guardrail rejects
 * deep platform imports — and across a federation boundary it cannot be loaded at all. So: no
 * subpath under the entry specifier, no relative path into the library from outside it, no second
 * alias into it in any tsconfig — a project's own `paths` included — and the alias and the
 * published `ng-package.json` both name the barrel. The package root lists the subpath in
 * `PLATFORM_ENTRY_POINTS`, which customers and the docs read as the set of entry points.
 */
function checkSatoriComponentsEntryPoint() {
  checkLibraryEntryPoint(SATORI_LIBRARIES[0]);
}

/** `/components-satori` is held to the same single-entry-point rule as the base library. */
function checkSatoriFallbackEntryPoint() {
  checkLibraryEntryPoint(SATORI_LIBRARIES[1]);
}

const PLATFORM_INDEX = 'libs/platform/src/index.ts';

/**
 * The subpaths `PLATFORM_ENTRY_POINTS` lists, or `null` when the package root does not export it as
 * a literal list of strings, optionally `as const` and wrapped in `Object.freeze(...)`.
 */
function platformEntryPoints() {
  if (!fileExists(PLATFORM_INDEX)) return null;
  const source = ts.createSourceFile(
    PLATFORM_INDEX,
    read(PLATFORM_INDEX),
    ts.ScriptTarget.Latest,
    true,
  );
  const unwrap = (node) => {
    let current = node;
    while (
      current &&
      (ts.isAsExpression(current) ||
        ts.isSatisfiesExpression(current) ||
        ts.isParenthesizedExpression(current))
    ) {
      current = current.expression;
    }
    return current;
  };
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    if (!statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== 'PLATFORM_ENTRY_POINTS') {
        continue;
      }
      let list = unwrap(declaration.initializer);
      if (
        list &&
        ts.isCallExpression(list) &&
        list.expression.getText(source) === 'Object.freeze' &&
        list.arguments.length === 1
      ) {
        list = unwrap(list.arguments[0]);
      }
      if (!list || !ts.isArrayLiteralExpression(list)) return null;
      if (!list.elements.every((element) => ts.isStringLiteralLike(element))) return null;
      return list.elements.map((element) => element.text);
    }
  }
  return null;
}

function checkLibraryEntryPoint({ root, entry, barrel, ngPackage }) {
  if (!fileExists(barrel)) {
    fail(
      `${barrel} does not exist, so the library has no entry point ` +
        'and the no-deep-imports rule asserted nothing.',
    );
    return;
  }

  const pathMaps = tsconfigPathMaps();
  const inLibrary = (path) => path === root || path.startsWith(`${root}/`);
  const isBarrelOnly = (targets) => targets.length === 1 && targets[0] === barrel;

  const base = pathMaps.find((map) => map.declaredIn === 'tsconfig.base.json')?.paths ?? {};
  const entryTargets = base[entry] ?? [];
  if (!isBarrelOnly(entryTargets)) {
    fail(
      `tsconfig.base.json must map \`${entry}\` to exactly ` +
        `\`${barrel}\`; it maps it to ${JSON.stringify(entryTargets)}.`,
    );
  }
  for (const { declaredIn, paths } of pathMaps) {
    for (const [alias, targets] of Object.entries(paths)) {
      if (alias === entry) {
        // A project that declares `paths` must re-declare the entry, and may — to the barrel.
        if (declaredIn !== 'tsconfig.base.json' && !isBarrelOnly(targets)) {
          fail(
            `${declaredIn} maps \`${entry}\` to ${JSON.stringify(targets)}; ` +
              `like tsconfig.base.json it must name exactly \`${barrel}\`.`,
          );
        }
        continue;
      }
      const into = targets.filter(inLibrary);
      if (into.length > 0) {
        fail(
          `${declaredIn} alias \`${alias}\` points into ${root} ` +
            `(${into.join(', ')}). The library has one entry point, \`${entry}\`; ` +
            'a second alias is a deep import with a name.',
        );
      }
    }
  }

  if (!fileExists(ngPackage)) {
    fail(`${ngPackage} is missing, so \`${entry}\` is not published.`);
  } else {
    let entryFile;
    try {
      entryFile = JSON.parse(read(ngPackage)).lib?.entryFile;
    } catch {
      entryFile = undefined;
    }
    const resolved = entryFile ? toPosixRel(join(dirname(ngPackage), entryFile)) : null;
    if (resolved !== barrel) {
      fail(
        `${ngPackage} must publish \`${barrel}\`; its entryFile resolves to ` +
          `${resolved ?? '(none)'}.`,
      );
    }
  }

  const subpath = entry.slice('@nuxeo-satori/platform/'.length);
  const listed = platformEntryPoints();
  if (!listed) {
    fail(
      `${PLATFORM_INDEX} does not export \`PLATFORM_ENTRY_POINTS\` as a literal list of strings, ` +
        `so whether it lists \`${subpath}\` was not checked.`,
    );
  } else if (!listed.includes(subpath)) {
    fail(
      `${PLATFORM_INDEX} does not list '${subpath}' in \`PLATFORM_ENTRY_POINTS\`, so the package ` +
        `root does not advertise \`${entry}\`, which ${ngPackage} publishes.`,
    );
  }

  const consumers = [
    ...walk('apps', (path) => /\.(ts|mts|js|mjs)$/.test(path)),
    ...walk('libs', (path) => /\.(ts|mts|js|mjs)$/.test(path)),
  ].filter((path) => !inLibrary(path));
  for (const file of consumers) {
    for (const specifier of importSpecifiers(read(file))) {
      if (specifier === entry) continue;
      let target = null;
      if (specifier.startsWith(`${entry}/`)) {
        target = specifier;
      } else if (specifier.startsWith('.')) {
        const path = toPosixRel(join(dirname(file), specifier));
        if (inLibrary(path)) target = path;
      } else {
        target = (resolveSpecifier(file, specifier, pathMaps) ?? []).find(inLibrary) ?? null;
      }
      if (target) {
        fail(
          `${file} imports \`${specifier}\`, which reaches into ${root} past its ` +
            `entry point. Import from \`${entry}\`, and export what you need from ` +
            `${barrel} if it is not there yet.`,
        );
      }
    }
  }
}

/**
 * The two federation-readiness rules a static check can hold today (plan section 7).
 *
 * - **Standalone only.** A remote exposes standalone components; an NgModule does not survive the
 *   boundary cleanly. So no `@NgModule`, and every `@Component`, `@Directive` and `@Pipe` says
 *   `standalone: true` — the repo convention, stated rather than left to the Angular 19+ default.
 * - **No `providedIn` singletons.** A root-provided service is one instance per Angular platform,
 *   and a host and a remote are two, so the "singleton" silently becomes two. That is the trap that
 *   forced the adf-hx ports into root-injector binding. Shared state goes behind an
 *   `InjectionToken` with an explicit `provide…()` function, so host and remote can share one
 *   instance. Every `providedIn` value is refused, `'platform'` and `'any'` included.
 *
 * Specs are exempt: a test host is not part of the library. `/components-satori` ships in the same
 * package and is held to the same rules; its absence is `checkSatoriFallbackDependencies`' to report.
 */
function checkSatoriComponentsFederationReadiness() {
  const nonSpec = (path) => /\.(ts|mts)$/.test(path) && !/\.(spec|test)\.ts$/.test(path);
  const sources = satoriComponentsSources().filter(nonSpec);
  if (sources.length === 0) {
    fail(
      `${SATORI_COMPONENTS_ROOT} has no non-spec TypeScript sources, so the federation-readiness ` +
        'rules asserted nothing.',
    );
    return;
  }

  for (const file of [...sources, ...walk(`${SATORI_FALLBACK_ROOT}/src`, nonSpec)]) {
    const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
    const lineOf = (node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    const decoratorName = angularDecoratorNamer(source);
    const keyOf = (property) => metadataKey(property, source);

    const visit = (node) => {
      if (ts.isDecorator(node) && ts.isCallExpression(node.expression)) {
        const name = decoratorName(node.expression.expression);
        if (name === 'NgModule') {
          fail(
            `${file}:${lineOf(node)} declares an @NgModule. The component library is standalone ` +
              'only — an NgModule does not cross a federation boundary cleanly. Export the ' +
              'standalone pieces, or a `provide…()` function for their providers.',
          );
        } else if (['Component', 'Directive', 'Pipe'].includes(name)) {
          const [config] = node.expression.arguments;
          const standalone =
            config && ts.isObjectLiteralExpression(config)
              ? config.properties.find(
                  (p) => ts.isPropertyAssignment(p) && keyOf(p) === 'standalone',
                )
              : undefined;
          if (!standalone || standalone.initializer.kind !== ts.SyntaxKind.TrueKeyword) {
            fail(
              `${file}:${lineOf(node)} @${name} does not say \`standalone: true\`. Every component, ` +
                'directive and pipe in the library is standalone, and says so.',
            );
          }
        }
      }
      if (
        (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) &&
        keyOf(node) === 'providedIn'
      ) {
        fail(
          `${file}:${lineOf(node)} uses \`providedIn\`. A provided-in singleton becomes two ` +
            'instances across a federation boundary. Put shared state behind an InjectionToken ' +
            'and export an explicit `provide…()` function instead.',
        );
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
}

/** The local names `@angular/core`'s `Component` is imported under in a source file. */
function componentDecoratorNames(source) {
  const names = new Set();
  const namespaces = new Set();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (statement.moduleSpecifier.text !== '@angular/core') continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings) continue;
    if (ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
    else {
      for (const element of bindings.elements) {
        if ((element.propertyName ?? element.name).text === 'Component') {
          names.add(element.name.text);
        }
      }
    }
  }
  return { names, namespaces };
}

/** The first file `resolveSpecifier` finds for a specifier, or `null` if it names none. */
function resolveFile(fromFile, specifier, pathMaps) {
  return resolveSpecifier(fromFile, specifier, pathMaps)?.[0] ?? null;
}

/**
 * An object literal member's key as JavaScript reads it: `stories`, `'stories'` and `['stories']`
 * are one key. `undefined` for a spread, or for a key computed any other way.
 */
function staticPropertyKey(member) {
  const name = member.name;
  if (!name) return undefined;
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  if (!ts.isComputedPropertyName(name)) return undefined;
  let key = name.expression;
  while (
    ts.isParenthesizedExpression(key) ||
    ts.isAsExpression(key) ||
    ts.isSatisfiesExpression(key)
  ) {
    key = key.expression;
  }
  return ts.isStringLiteralLike(key) ? key.text : undefined;
}

/**
 * The `@Component` classes a module exports, by public name, following re-exports.
 *
 * `export class X` with a `@Component` decorator, `export { a as b } from './m'`,
 * `export * from './m'`, and an imported or locally declared class exported by a bare
 * `export { X }`.
 */
function exportedComponentClasses(file, pathMaps, ancestors = new Set()) {
  // `ancestors` guards a re-export cycle along one path only: a module re-exported twice from
  // one barrel must be read twice, or the second statement finds nothing.
  const seen = ancestors;
  const found = new Map();
  if (seen.has(file) || !fileExists(file)) return found;
  seen.add(file);
  const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
  const imported = new Map();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      imported.set(element.name.text, {
        specifier: statement.moduleSpecifier.text,
        name: (element.propertyName ?? element.name).text,
      });
    }
  }
  const { names, namespaces } = componentDecoratorNames(source);
  const isComponentDecorator = (decorator) => {
    if (!ts.isCallExpression(decorator.expression)) return false;
    const callee = decorator.expression.expression;
    if (ts.isIdentifier(callee)) return names.has(callee.text);
    return (
      ts.isPropertyAccessExpression(callee) &&
      ts.isIdentifier(callee.expression) &&
      namespaces.has(callee.expression.text) &&
      callee.name.text === 'Component'
    );
  };
  const declared = new Set(
    source.statements
      .filter(
        (statement) =>
          ts.isClassDeclaration(statement) &&
          statement.name &&
          (ts.getDecorators(statement) ?? []).some(isComponentDecorator),
      )
      .map((statement) => statement.name.text),
  );

  for (const statement of source.statements) {
    if (ts.isClassDeclaration(statement) && statement.name) {
      const exported = statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      if (exported && declared.has(statement.name.text)) {
        found.set(statement.name.text, { file, className: statement.name.text });
      }
      continue;
    }
    if (!ts.isExportDeclaration(statement) || statement.isTypeOnly) continue;
    if (!statement.moduleSpecifier) {
      if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) continue;
      for (const element of statement.exportClause.elements) {
        if (element.isTypeOnly) continue;
        const localName = (element.propertyName ?? element.name).text;
        if (declared.has(localName)) {
          found.set(element.name.text, { file, className: localName });
          continue;
        }
        const local = imported.get(localName);
        if (!local) continue;
        const target = resolveFile(file, local.specifier, pathMaps);
        const origin =
          target && exportedComponentClasses(target, pathMaps, new Set(seen)).get(local.name);
        if (origin) found.set(element.name.text, origin);
      }
      continue;
    }
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const target = resolveFile(file, statement.moduleSpecifier.text, pathMaps);
    if (!target) continue;
    const inner = exportedComponentClasses(target, pathMaps, new Set(seen));
    if (!statement.exportClause) {
      for (const [name, origin] of inner) found.set(name, origin);
    } else if (ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        if (element.isTypeOnly) continue;
        const origin = inner.get((element.propertyName ?? element.name).text);
        if (origin) found.set(element.name.text, origin);
      }
    }
  }
  return found;
}

/**
 * The component classes a story file documents: `{ file, className }` keys, as `file#className`.
 *
 * A story counts when its default-exported meta names the class as `component:`, the class is
 * imported from the module that declares it, and the file exports at least one story. The meta may
 * be the default export itself or a variable it names, optionally behind `satisfies` or `as`.
 *
 * A story is a named export Storybook renders — `export const`, `export function` or a local
 * `export { … }`, under the name it is exported as: the meta's `includeStories` and
 * `excludeStories` apply, as a list of names or a regex literal. One the guardrail cannot read is a
 * failure.
 */
function storiedComponents(storyFile, pathMaps) {
  const covered = new Set();
  const source = ts.createSourceFile(storyFile, read(storyFile), ts.ScriptTarget.Latest, true);

  const imports = new Map();
  const variables = new Map();
  let defaultExport = null;
  const namedExports = [];
  const unwrap = (node) => {
    let current = node;
    while (
      current &&
      (ts.isSatisfiesExpression(current) ||
        ts.isAsExpression(current) ||
        ts.isParenthesizedExpression(current))
    ) {
      current = current.expression;
    }
    return current;
  };

  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const bindings = statement.importClause?.namedBindings;
      if (!bindings || !ts.isNamedImports(bindings)) continue;
      const target = resolveFile(storyFile, statement.moduleSpecifier.text, pathMaps);
      if (!target) continue;
      for (const element of bindings.elements) {
        imports.set(element.name.text, {
          file: target,
          name: (element.propertyName ?? element.name).text,
        });
      }
    } else if (ts.isVariableStatement(statement)) {
      const exported = statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        variables.set(declaration.name.text, declaration.initializer);
        if (exported) namedExports.push(declaration.name.text);
      }
    } else if (ts.isFunctionDeclaration(statement) && statement.name) {
      const kinds = (statement.modifiers ?? []).map((m) => m.kind);
      if (
        kinds.includes(ts.SyntaxKind.ExportKeyword) &&
        !kinds.includes(ts.SyntaxKind.DefaultKeyword)
      ) {
        namedExports.push(statement.name.text);
      }
    } else if (
      ts.isExportDeclaration(statement) &&
      !statement.moduleSpecifier &&
      !statement.isTypeOnly &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      // `export { Basic }`, `export { story as Basic }` and `export { meta as default }`: Storybook
      // reads each under the name it is exported as.
      for (const element of statement.exportClause.elements) {
        if (element.isTypeOnly) continue;
        if (element.name.text === 'default') {
          defaultExport = ts.factory.createIdentifier((element.propertyName ?? element.name).text);
        } else {
          namedExports.push(element.name.text);
        }
      }
    } else if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      defaultExport = unwrap(statement.expression);
    }
  }

  if (defaultExport && ts.isIdentifier(defaultExport)) {
    defaultExport = unwrap(variables.get(defaultExport.text));
  }
  if (!defaultExport || !ts.isObjectLiteralExpression(defaultExport)) return covered;
  // A spread can carry `excludeStories` this cannot see, so the file counts no story.
  if (defaultExport.properties.some(ts.isSpreadAssignment)) {
    fail(
      `${storyFile} spreads another object into its default-exported meta, so which of its ` +
        'exports are stories was not read and none was counted. Write the meta inline.',
    );
    return covered;
  }
  // A computed key can be `excludeStories` as easily as anything else, so the file counts no story.
  if (defaultExport.properties.some((p) => staticPropertyKey(p) === undefined)) {
    fail(
      `${storyFile} computes a key of its default-exported meta, so which of its exports are ` +
        'stories was not read and none was counted. Write each key as a name or a string.',
    );
    return covered;
  }
  // A property's value — the last one, as JavaScript keeps it when a key repeats. A shorthand
  // (`{ excludeStories }`) is the file's top-level constant of that name; `undefined` when there is
  // none to read, or the key is a method or an accessor.
  const metaProperty = (name) => {
    const property = defaultExport.properties.findLast((p) => staticPropertyKey(p) === name);
    if (!property) return null;
    if (ts.isPropertyAssignment(property)) return unwrap(property.initializer);
    if (ts.isShorthandPropertyAssignment(property)) return unwrap(variables.get(name));
    return undefined;
  };

  // `includeStories` / `excludeStories` as Storybook applies them; `undefined` when unreadable.
  const storyFilter = (name) => {
    const value = metaProperty(name);
    if (value === null) return null;
    if (!value) return undefined;
    if (ts.isArrayLiteralExpression(value) && value.elements.every(ts.isStringLiteralLike)) {
      const names = new Set(value.elements.map((element) => element.text));
      return (exportName) => names.has(exportName);
    }
    if (ts.isRegularExpressionLiteral(value)) {
      const [, pattern, flags] = /^\/(.*)\/([a-z]*)$/s.exec(value.text) ?? [];
      try {
        const regex = new RegExp(pattern, flags.replace(/[gy]/g, ''));
        return (exportName) => regex.test(exportName);
      } catch {
        return undefined;
      }
    }
    return undefined;
  };
  const include = storyFilter('includeStories');
  const exclude = storyFilter('excludeStories');
  for (const [name, filter] of [
    ['includeStories', include],
    ['excludeStories', exclude],
  ]) {
    if (filter === undefined) {
      fail(
        `${storyFile} sets \`${name}\` to something other than a list of names or a regex ` +
          'literal, so which of its exports are stories was not read and none was counted.',
      );
      return covered;
    }
  }
  const stories = namedExports.filter(
    (name) =>
      name !== '__namedExportsOrder' && (!include || include(name)) && !(exclude && exclude(name)),
  );
  if (stories.length === 0) return covered;

  const value = metaProperty('component');
  if (!value || !ts.isIdentifier(value)) return covered;
  const origin = imports.get(value.text);
  if (!origin) return covered;

  // The import may itself be a barrel; resolve the name to the module that declares the class.
  const declared = exportedComponentClasses(origin.file, pathMaps).get(origin.name);
  if (declared) covered.add(`${declared.file}#${declared.className}`);
  return covered;
}

/**
 * The `stories` globs a Storybook `main.ts` exports, read from its syntax tree — the default export
 * or the constant it names, behind `satisfies` or `as` — so a comment mentioning a glob does not
 * count. The last `stories` key is the one JavaScript keeps. `null` when the list is not string
 * literals the guardrail can read, or the config has a spread or a computed key that could replace
 * it.
 */
function storybookStoryGlobs(main) {
  const source = ts.createSourceFile(main, read(main), ts.ScriptTarget.Latest, true);
  const unwrap = (node) => {
    let current = node;
    while (
      current &&
      (ts.isSatisfiesExpression(current) ||
        ts.isAsExpression(current) ||
        ts.isParenthesizedExpression(current))
    ) {
      current = current.expression;
    }
    return current;
  };
  const variables = new Map();
  let config = null;
  for (const statement of source.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          variables.set(declaration.name.text, declaration.initializer);
        }
      }
    } else if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      config = unwrap(statement.expression);
    }
  }
  const resolve = (node) =>
    node && ts.isIdentifier(node) ? unwrap(variables.get(node.text)) : node;
  config = resolve(config);
  if (!config || !ts.isObjectLiteralExpression(config)) return null;
  if (config.properties.some((p) => staticPropertyKey(p) === undefined)) return null;
  const property = config.properties.findLast((p) => staticPropertyKey(p) === 'stories');
  if (!property) return null;
  if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property))
    return null;
  const value = resolve(
    ts.isPropertyAssignment(property) ? unwrap(property.initializer) : property.name,
  );
  if (!value || !ts.isArrayLiteralExpression(value)) return null;
  if (!value.elements.every(ts.isStringLiteralLike)) return null;
  return value.elements.map((element) => element.text);
}

/**
 * Every component the library exports has a story (plan section 9.4).
 *
 * Storybook is the library's human documentation and the agent's usage reference, so a component
 * without a story ships undocumented. Read from the barrel, because an exported component is a
 * published one. A story is a `*.stories.ts` under `src/` — the glob `.storybook/main.ts` loads,
 * which is checked too — whose meta names the class as `component:`; a file that only mentions the
 * class, or names it with no story exported, does not count.
 */
function checkSatoriComponentsHaveStories() {
  if (!fileExists(SATORI_COMPONENTS_BARREL)) return;
  const pathMaps = tsconfigPathMaps();
  const exported = exportedComponentClasses(SATORI_COMPONENTS_BARREL, pathMaps);
  if (exported.size === 0) return;

  const STORY_GLOB = '../src/**/*.stories.ts';
  const main = `${SATORI_COMPONENTS_STORYBOOK}/main.ts`;
  if (!fileExists(main)) {
    fail(
      `${main} does not exist, so the ${exported.size} component(s) ${SATORI_COMPONENTS_BARREL} ` +
        'exports have no Storybook to be documented in.',
    );
  } else {
    const globs = storybookStoryGlobs(main);
    if (globs === null) {
      fail(
        `${main} does not export a \`stories\` list of string literals, with no spread or ` +
          'computed key beside it, so whether Storybook loads the stories this check counts was ' +
          'not read.',
      );
    } else if (!globs.includes(STORY_GLOB)) {
      fail(
        `${main} does not load \`${STORY_GLOB}\`, so the stories this check counts are not the ` +
          'ones Storybook renders.',
      );
    }
  }

  const covered = new Set();
  for (const story of walk(`${SATORI_COMPONENTS_ROOT}/src`, (path) =>
    path.endsWith('.stories.ts'),
  )) {
    for (const key of storiedComponents(story, pathMaps)) covered.add(key);
  }
  for (const [name, { file, className }] of exported) {
    if (covered.has(`${file}#${className}`)) continue;
    fail(
      `${SATORI_COMPONENTS_BARREL} exports \`${name}\` (${file}), and no story documents it. Add ` +
        `a \`*.stories.ts\` beside it whose default-exported meta says \`component: ${className}\`, ` +
        'with at least one story exported — Storybook is the library’s documentation and the ' +
        'agent’s usage reference.',
    );
  }
}

const NUXEO_UI_APP_CONFIG = 'apps/nuxeo-ui/src/app/app.config.ts';

/**
 * The product registers the primitives on Material, then on Satori (plan section 3).
 *
 * Registration layers in provider order and later wins, so the order is the whole mechanism: listed
 * the other way round, Material silently replaces every Satori primitive and nothing else goes red.
 * Read from the AST of the `providers` array — its element order is the provider order — so a call
 * in a comment or a string counts for nothing.
 */
function checkSatoriPrimitivesRegisteredInOrder() {
  if (!fileExists(NUXEO_UI_APP_CONFIG)) {
    fail(
      `${NUXEO_UI_APP_CONFIG} does not exist, so the primitive registration order was not checked.`,
    );
    return;
  }
  const source = ts.createSourceFile(
    NUXEO_UI_APP_CONFIG,
    read(NUXEO_UI_APP_CONFIG),
    ts.ScriptTarget.Latest,
    true,
  );
  const calls = ['provideNxsComponents', 'provideNxsSatoriComponents'];
  let positions = null;
  const visit = (node) => {
    if (positions) return;
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText(source) === 'providers' &&
      ts.isArrayLiteralExpression(node.initializer)
    ) {
      const names = node.initializer.elements.map((element) =>
        ts.isCallExpression(element) && ts.isIdentifier(element.expression)
          ? element.expression.text
          : null,
      );
      positions = calls.map((call) => names.indexOf(call));
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  if (!positions) {
    fail(
      `${NUXEO_UI_APP_CONFIG} has no \`providers\` array, so the registration order was not checked.`,
    );
    return;
  }
  const [material, satori] = positions;
  for (const [index, call] of calls.entries()) {
    if (positions[index] === -1) {
      fail(
        `${NUXEO_UI_APP_CONFIG} does not call \`${call}()\` in its providers. The product includes ` +
          'both registrations: Material from `/components`, re-registered on Satori by `/components-satori`.',
      );
    }
  }
  if (material !== -1 && satori !== -1 && satori < material) {
    fail(
      `${NUXEO_UI_APP_CONFIG} lists \`provideNxsSatoriComponents()\` before \`provideNxsComponents()\`. ` +
        'Later registrations win, so Material replaces every Satori primitive. Swap them.',
    );
  }
}

const GUARDRAILS = [
  checkThemeTokens,
  checkDocsNumbering,
  checkNoReviewCorpusChurn,
  checkVitestProjects,
  checkBlobUrlLifecycle,
  checkNoNuxeoUrlInImgSrc,
  checkNoAttrPrefixedLiteralAttributes,
  checkTypeSafetyEscapes,
  checkHardcodedSecrets,
  checkAngularDevAssets,
  checkAdfHxWorkaroundIds,
  checkNoAdfHxInPublicApi,
  checkNoHardcodedUiText,
  checkNoHardcodedDescriptorText,
  checkNoHardcodedDialogText,
  checkNoHardcodedImperativeUiText,
  checkTranslateIsInjectedWhereUsed,
  checkCatalogueValuesAreRenderable,
  checkNoStaleAgnosticClaim,
  checkTranslationCatalogues,
  checkCataloguesAreTranslated,
  checkCataloguePlaceholders,
  checkAdvertisedLocalesShip,
  checkCrowdinConfig,
  checkPackagedConfigIsNotADemo,
  checkInstallerOwnsNoCustomerFile,
  checkTranslationContext,
  checkTranslatorNotesFlagProductsAndAcronyms,
  checkPlatformEnglishFallback,
  checkTranslatorContextPush,
  checkNoProseInComponentInputs,
  checkNoTemplateSyntaxInDocumentShell,
  checkNoRootAbsoluteShippedAssetPaths,
  checkShippedDefaultLanguage,
  checkAccessibleNameFallbacks,
  checkLocaleDataRegistered,
  checkSatoriComponentsDependencies,
  checkSatoriComponentsEntryPoint,
  checkSatoriComponentsFederationReadiness,
  checkSatoriComponentsHaveStories,
  checkSatoriFallbackDependencies,
  checkSatoriFallbackEntryPoint,
  checkSatoriPrimitivesRegisteredInOrder,
];

/**
 * `--only <csv>` runs a subset, by function name.
 *
 * This exists for `review-guardrails.selftest.mjs`, which builds a throwaway git repository per
 * negative control and needs one guardrail's verdict from it. Running the whole set against a
 * fixture repository would report a dozen unrelated failures and prove nothing about the one
 * under test.
 *
 * An unknown name exits 2 with the real list, rather than silently running nothing — a typo that
 * selects an empty set would make every control in the selftest pass.
 */
function selectGuardrails() {
  const only = args.get('only');
  if (only === undefined || only === true) return GUARDRAILS;

  const wanted = new Set(
    String(only)
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean),
  );
  const byName = new Map(GUARDRAILS.map((guardrail) => [guardrail.name, guardrail]));

  const unknown = [...wanted].filter((name) => !byName.has(name));
  if (unknown.length || wanted.size === 0) {
    console.error(
      `review-guardrails: unknown --only value(s): ${unknown.join(', ') || '(empty)'}\n` +
        `Available:\n  ${[...byName.keys()].join('\n  ')}`,
    );
    process.exit(2);
  }
  return [...wanted].map((name) => byName.get(name));
}

// Awaited: `checkTranslatorContextPush` imports the context-push script to run its flattener on
// fixtures, which needs a dynamic `import()`. Awaiting a synchronous guardrail is a no-op, so
// every other one is unaffected.
for (const guardrail of selectGuardrails()) await guardrail();

if (warnings.length) {
  console.warn('\nReview guardrail warnings:');
  for (const message of warnings) console.warn(`- ${message}`);
}

if (failures.length) {
  console.error('\nReview guardrail failures:');
  for (const message of failures) console.error(`- ${message}`);
  process.exit(1);
}

console.log('Review guardrails passed.');
