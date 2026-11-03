#!/usr/bin/env node
/**
 * Drift gate for the customer-facing extension reference.
 *
 * ## Why this exists
 *
 * `docs/extension-reference.md` is the only document whose header names customers as
 * its audience, and it is the contract they program against: every addressable ID,
 * and for each slot whether it is populated, merely resolvable, or reserved and
 * inert. Nothing checked it against the code.
 *
 * When it was first measured, it was wrong in both directions:
 *
 * - It claimed the `documentList` slot was "Declared; **nothing resolves it**". Twelve
 *   column IDs are registered in `provide-app-extensions.ts`, and **both** the
 *   production browse and the adf-hx route call `resolve()` on it. A customer reading
 *   the reference would believe document list columns are not configurable when they
 *   are — the document undersold a working capability.
 * - It used `app.toolbar.delete` as its running security example. That ID exists only
 *   in spec files, so a customer overriding it would be overriding nothing.
 *
 * Both are the same failure the API surface gate exists for, one document over.
 *
 * ## What it checks
 *
 * IDs are the platform's `app.` ones and the component library's `nxs.` ones.
 *
 * 1. Every ID the document presents as real is registered in non-spec source.
 * 2. Every ID registered in non-spec source is documented.
 * 3. Every slot-state claim in the document's table matches whether the slot is
 *    actually registered into and actually resolved.
 *
 * ## What it deliberately does not check
 *
 * Spec fixtures are excluded from "registered", because a spec is not a contract —
 * `app.rules.definitelyNotRegistered` and `app.toolbar.typo` are test data. It also
 * cannot tell whether a resolved slot is *rendered*: a component may resolve a slot
 * and drop the result. `resolve()` is the closest static proxy for "the host asks",
 * which is what the document's middle state actually claims.
 *
 * Usage:
 *   node scripts/beta-harness/extension-reference-drift.mjs
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/**
 * The repository to inspect. `--root <dir>` overrides it, following `dependency-tree.mjs`.
 *
 * It exists so this gate can have negative controls at all. Every defect found in it so far — a
 * table helper that scanned past its section, a header/separator pair taken on trust, rows
 * silently skipped, a class name resolved to the wrong component, a temporal dead zone on the
 * alias path — was found by a human reading the diff, because the gate could only ever be run
 * against the one repository it lives in, and that repository is correct. With `--root`, a control
 * can build a miniature repository that is wrong on purpose and watch the gate go red.
 *
 * Validated rather than trusted, for the reason `--ledger` on `published-links.mjs` was: a flag
 * whose misuse surfaces as a Node stack trace reads as a defect in the gate.
 */
const ROOT = (() => {
  const at = process.argv.indexOf('--root');
  if (at === -1) return resolve(import.meta.dirname, '..', '..');
  const given = process.argv[at + 1];
  const refuse = (why) => {
    console.error(
      `extension-reference-drift: --root ${why}\n` +
        '  Usage: node scripts/beta-harness/extension-reference-drift.mjs [--root <dir>]\n' +
        '  The directory must contain docs/extension-reference.md and at least one of apps/ or libs/.',
    );
    process.exit(1);
  };
  if (given === undefined || given.startsWith('--')) {
    refuse(`needs a directory, and was given ${given === undefined ? 'nothing' : `\`${given}\``}.`);
  }
  const root = resolve(given);
  if (!existsSync(root) || !statSync(root).isDirectory())
    refuse(`\`${given}\` is not a directory.`);
  if (!existsSync(join(root, 'docs', 'extension-reference.md'))) {
    refuse(`\`${given}\` has no docs/extension-reference.md, so there is nothing to check.`);
  }
  return root;
})();
const REFERENCE = join(ROOT, 'docs', 'extension-reference.md');
const SOURCE_ROOTS = ['libs', 'apps'];

const failures = [];
const fail = (message) => failures.push(message);

/** Every non-spec TypeScript file under the source roots. */
/**
 * Escape every regex metacharacter, not just the four this file used to.
 *
 * The previous inline escape covered `.`, `[`, `]` and `'` — CodeQL's `js/incomplete-sanitization`,
 * three times. The tokens are our own slot constants, so nothing hostile reaches it, but this is a
 * **gate**: an unescaped `$` or `(` makes the pattern match something other than the token, and a
 * gate that matches the wrong thing is worse than one that fails.
 * @param {string} s
 */
function reEscape(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The declaration of a class by name, in any form this repository can reach it through.
 *
 * **One definition, used by both lookups**, because they are the same question and keeping two
 * copies is what produced two of the findings on this gate: the `default` modifier was added to
 * the lookup in `selectorOfBinding` and not to the declarer search in `selectorOf`, and the
 * second site then counted `export default class X {}` as "not a declaration" — under-counting
 * declarers, which is the direction that disables the ambiguity refusal rather than firing it.
 *
 * **Every modifier is optional, including `export` itself.** Requiring it assumed that a class
 * worth resolving is always exported at its declaration, and three forms break that:
 *
 *   - `class X {}` with a separate `export default X;` — reported on PR #555, and it rejected a
 *     *correct* row: the default-export branch recursed with the declared name, found no
 *     `export class X`, and the gate reported it could read no selector for the module's default.
 *   - `class X {}` with a separate `export { X };`.
 *   - a class declared and registered in the same file, which never needs to be exported at all.
 *
 * Matching a bare `class X` also means a non-exported local class elsewhere now counts as a
 * declarer in the global fallback. That is deliberate and it is the safe direction: an extra
 * declarer can only make the ambiguity refusal fire, which is a loud, investigable refusal to
 * guess, whereas a missed one lets an unrelated namesake's selector be accepted as identity.
 *
 * @param {string} name
 * @returns {RegExp}
 */
function classDeclaration(name) {
  return new RegExp(
    String.raw`\b(?:export\s+(?:default\s+)?)?(?:abstract\s+)?class\s+${reEscape(name)}\b`,
  );
}

/**
 * Every non-spec TypeScript file under the source roots.
 *
 * A source root that cannot be listed is a **reported gap**, not a root to skip. `walk()` called
 * `readdirSync` unconditionally, so a repository without an `apps/` directory crashed the gate
 * with an ENOENT stack trace — found by this gate's own new controls on their first run, because
 * a fixture repository legitimately has only the directories its control needs.
 *
 * Reported rather than skipped, because skipping is the direction that goes quiet: every
 * registered ID lives under these roots, so a root this gate cannot read is a run whose "all
 * registered IDs are documented" verdict covers less than it says. That is the same policy
 * `dependency-tree.mjs` applies to a scan root it cannot inspect.
 */
function sourceFiles() {
  const found = [];
  for (const root of SOURCE_ROOTS) {
    const dir = join(ROOT, root);
    if (!existsSync(dir)) {
      fail(
        `${root}/ does not exist under ${ROOT}, so this gate cannot see the IDs registered there ` +
          'and its verdict would cover less than it claims.',
      );
      return [];
    }
  }
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (
        entry.endsWith('.ts') &&
        !entry.endsWith('.spec.ts') &&
        !entry.endsWith('.test.ts') &&
        // i18n catalogues key on `app.<surface>.<name>` too, but those are
        // translation keys, not extension points — `app.nav.toggle` is the string
        // "Toggle navigation menu".
        !full.includes(`${sep}i18n${sep}`)
      ) {
        found.push(full);
      }
    }
  };
  for (const root of SOURCE_ROOTS) walk(join(ROOT, root));
  return found;
}

/**
 * Comments removed before anything is matched against source.
 *
 * Every check below decides "does the code do X?" by searching source text, and a
 * commented-out `resolve(EXTENSION_SLOTS.tabs)` — or a doc comment quoting one as an
 * example, which is the far more likely case — satisfied that search exactly as well as
 * real code. So a slot the reference calls live could be proven live by its own
 * explanatory comment.
 *
 * This is not hypothetical in this repository. Three generators spliced every
 * registration *inside a comment*, reported success, printed the IDs they had
 * "registered", and passed lint, typecheck and six specs — because nothing distinguished
 * code from prose about code. The same blind spot in a gate whose entire job is to catch
 * a document that overstates the product would have hidden the identical failure.
 *
 * Deliberately naive: a `//` inside a string literal (`'https://x'`) truncates that line.
 * That can only ever *remove* text, so it can make a check miss a real occurrence — a
 * false alarm, loud and investigable — and never invent one. The failure direction that
 * matters here is the silent one, and this closes it.
 */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * The pseudo-name used for a module's default export while following a binding.
 *
 * A default import has no exported name at the import site — `import X from 'm'` says nothing
 * about what `m` calls it — so a default-imported class cannot be identified by name at all. That
 * was the hole: the named-import matcher could not see the clause, resolution fell through to a
 * global search, and an unrelated class of the same name had its selector accepted. Reported on
 * PR #555; reproduced with a module default-exporting `ActualComponent` while an unrelated
 * `FxCardComponent` elsewhere declared a different selector, and the gate accepted the unrelated
 * one.
 *
 * Declared here with the other module constants, not beside the function that uses it — the same
 * placement `TSCONFIG_PATHS` below needed, and for the same reason. Put next to `parseBindings()`
 * it sat in its own temporal dead zone relative to the section-6b loop that reaches it, and threw
 * `ReferenceError: Cannot access 'DEFAULT_BINDING' before initialization`. Caught by running this
 * gate's own controls before replying, which is the only reason it is not in the diff.
 */
const DEFAULT_BINDING = Symbol('default export');

/**
 * `compilerOptions.paths` from `tsconfig.base.json`, for resolving a path-alias import.
 *
 * Declared **here**, with the other module constants, and not beside the function that uses it.
 * It was declared at the bottom of the file, after the section-6b validation loop that reaches it
 * through `selectorOf()` → `resolveModule()` — and a `const` is in its temporal dead zone until
 * its own line runs. So the first 6b row whose component is imported through an alias crashed the
 * gate with `ReferenceError: Cannot access 'TSCONFIG_PATHS' before initialization`, rejecting a
 * valid registered-and-documented component. The empty table hid it. Found by review on PR #544
 * and reproduced before fixing.
 *
 * `null` rather than `{}` when it cannot be read, so `resolveModule` can tell "no aliases are
 * configured" from "I could not find out" and report the second instead of silently losing alias
 * resolution.
 */
const TSCONFIG_PATHS = (() => {
  try {
    const raw = readFileSync(join(ROOT, 'tsconfig.base.json'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
    return JSON.parse(raw).compilerOptions?.paths ?? {};
  } catch {
    return null;
  }
})();

const files = sourceFiles();
const sources = new Map(files.map((f) => [f, stripComments(readFileSync(f, 'utf8'))]));
const allSource = [...sources.values()].join('\n');
const reference = readFileSync(REFERENCE, 'utf8');

/**
 * IDs the document presents as real: ours are `app.*`, and the `nxs-` component library's
 * are `nxs.*`, both one public contract.
 *
 * Only backticked ones, and only outside fenced code blocks: a JSON example may
 * legitimately show `acme.*` IDs a customer would invent, and the security section
 * discusses IDs in prose. Backticks in prose are how this document names a real ID.
 */
function documentedIds() {
  const withoutFences = reference.replace(/```[\s\S]*?```/g, '');
  const ids = new Set();
  for (const match of withoutFences.matchAll(/`((?:app|nxs)\.[a-zA-Z0-9.]+)`/g)) {
    // `app.routes.ts` and friends are filenames, not IDs.
    if (/\.(ts|mjs|json|html|scss|md)$/.test(match[1])) continue;
    if (match[1].split('.').length !== 3) continue;
    ids.add(match[1]);
  }
  return ids;
}

/** IDs registered in non-spec source. */
function registeredIds() {
  const ids = new Set();
  for (const match of allSource.matchAll(
    /['"`]((?:app|nxs)\.[a-zA-Z][a-zA-Z0-9]*\.[a-zA-Z][a-zA-Z0-9]*)['"`]/g,
  )) {
    // `'./app.config.ts'` and friends match the ID shape. A third segment that is a
    // file extension is a path, not an extension point.
    if (/\.(ts|mjs|js|json|html|scss|css|md)$/.test(match[1])) continue;
    ids.add(match[1]);
  }
  return ids;
}

const documented = documentedIds();
const registered = registeredIds();

const undocumented = [...registered].filter((id) => !documented.has(id)).sort();
const unregistered = [...documented].filter((id) => !registered.has(id)).sort();

if (unregistered.length) {
  fail(
    `${unregistered.length} ID(s) are documented as real but registered nowhere outside specs.\n` +
      '  A customer overriding one of these would be overriding nothing.\n' +
      unregistered.map((id) => `    ${id}`).join('\n'),
  );
}

if (undocumented.length) {
  fail(
    `${undocumented.length} ID(s) are registered but absent from the reference.\n` +
      '  An extension point nobody can discover is not an extension point.\n' +
      undocumented.map((id) => `    ${id}`).join('\n'),
  );
}

/**
 * The contiguous Markdown table that follows `anchor`, as its data rows.
 *
 * Every table check below was a regex over the **whole document**, which is how the slot-state
 * check came to be the only reader of a table it was not about: its first-cell pattern was
 * `` `[a-zA-Z-]+` ``, a component ID contains dots, so no row of the `nxs-` component table could
 * ever match it. The table has no rows, so nothing looked wrong — a gate that cannot tell
 * "correctly empty" from "silently emptied".
 *
 * Anchoring each check to its own table is the fix for the class rather than the instance: the
 * first-cell pattern can now accept a dotted ID without a row from some other table being
 * classified by accident, which is what widening the document-wide regex would have risked.
 *
 * ## The scan is bounded by the next heading, and an absent table is a failure
 *
 * Neither was true at first, and the two together were the worst defect in this gate. The search
 * for the table ran to the end of the document, so **deleting the table left the anchor pointing
 * at an unrelated one further down**. Driven on the real document: removing all thirteen rows of
 * the section-2 slot table made `tableAfter` latch onto the next table it could find, whose rows
 * the slot-claim pattern does not match, so `slotClaims()` returned zero claims, the `rows.length
 * === 0` guard never fired — `rows` was four — and the gate printed
 * *"every slot-state claim holds"* and exited 0 with the entire slot-state half gone.
 *
 * That is the precise failure this gate exists to catch, committed by the gate. Found by review
 * on PR #544, reproduced before fixing.
 *
 * @param {string} anchor a literal line, or the first line that contains it
 * @returns {string[]} the rows after the header and its `---` separator
 */
/**
 * The document's lines with fenced code blocks blanked out, positions preserved.
 *
 * A ```` ``` ```` block in this document contains JSON and shell examples, and some of those
 * contain `|`. Locating a table by "the next line starting with a pipe" would read one out of a
 * code sample. Blanked rather than removed so every index below still refers to a real line
 * number in the file.
 */
const linesOutsideFences = (() => {
  const lines = reference.split('\n');
  /**
   * The open fence's character and length, or `null` outside a fence.
   *
   * A boolean toggle was wrong, and in the direction that matters: CommonMark lets a four-backtick
   * fence *contain* triple-backtick lines, so the inner ``` closed the outer fence and everything
   * after it — including a worked example of a slot table — became visible to `tableAfter()`. A
   * fenced example could then satisfy the slot-state check while the real table was missing or
   * wrong, which is this gate's own defect class yet again. Raised in review on PR #555.
   *
   * A fence closes only on a run of the **same character** that is **at least as long** as the
   * one that opened it, with nothing but whitespace after it — CommonMark's rule.
   */
  let open = null;
  return lines.map((line) => {
    const match = /^\s{0,3}(`{3,}|~{3,})\s*(.*)$/.exec(line);
    if (match) {
      const [, marker, rest] = match;
      const char = marker[0];
      if (open === null) {
        // An opening fence may carry an info string; a closing one may not.
        open = { char, length: marker.length };
        return '';
      }
      if (char === open.char && marker.length >= open.length && rest.trim() === '') {
        open = null;
        return '';
      }
      // A shorter or different marker inside a fence is content, not a delimiter.
      return '';
    }
    return open === null ? line : '';
  });
})();

/** Split a table row into cells on unescaped pipes that are not inside inline code. */
function splitRow(line) {
  const cells = [];
  let cell = '';
  let inCode = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '\\' && i + 1 < line.length) {
      // An escaped pipe is content, not a delimiter.
      cell += line[i + 1];
      i += 1;
      continue;
    }
    if (ch === '`') {
      inCode = !inCode;
      cell += ch;
      continue;
    }
    if (ch === '|' && !inCode) {
      cells.push(cell);
      cell = '';
      continue;
    }
    cell += ch;
  }
  cells.push(cell);
  // A GitHub table row is written with a leading and a trailing pipe, so the first and last
  // fragments are empty and are not cells.
  if (cells.length >= 2 && cells[0].trim() === '' && cells[cells.length - 1].trim() === '') {
    return cells.slice(1, -1).map((c) => c.trim());
  }
  return cells.map((c) => c.trim());
}

/**
 * The data rows of the table that follows `anchor`, as `{ lineNumber, cells, line }`.
 *
 * ## Every structural assumption is now checked, because three review rounds landed here
 *
 * This function has been the subject of three consecutive review rounds on PR #544 — it scanned
 * past its own section, then trusted the header/separator pair, then let `slotClaims()` skip rows
 * it could not parse. Each fix closed the reported case and left an adjacent one open, so the
 * assumptions are enumerated and checked rather than discovered one review at a time:
 *
 * | Assumption | If violated |
 * | --- | --- |
 * | the anchor exists | fail |
 * | the anchor is unambiguous | fail — `findIndex` silently took the first of several |
 * | the anchor is not inside a code fence | not found there at all; fences are blanked |
 * | no heading between the anchor and the table | fail |
 * | no setext heading or thematic break between them | fail |
 * | the first pipe line is not inside a code fence | fences are blanked, so it cannot be |
 * | at least a header and a separator | fail |
 * | line two is the `\| --- \|` separator | fail |
 * | the separator's column count equals the header's | fail |
 * | every data row has the header's column count | fail |
 * | pipes inside inline code or escaped are content | handled by `splitRow` |
 *
 * **The assumption that is no longer load-bearing at all is the one that caused the harm.** Each
 * caller now declares how many rows it expects, from the code rather than from this document, so
 * no parsing failure here can reduce the work to zero and leave a check reporting success. See
 * `slotClaims()`.
 *
 * @param {string} anchor a literal line, or the first line that contains it
 * @param {string} what the caller's name for this table, used in diagnostics
 * @returns {{ lineNumber: number, cells: string[], line: string }[]}
 */
function tableAfter(anchor, what) {
  const lines = linesOutsideFences;
  const occurrences = lines.reduce(
    (acc, line, index) => (line.includes(anchor) ? [...acc, index] : acc),
    [],
  );
  if (occurrences.length === 0) {
    fail(
      `docs/extension-reference.md no longer contains \`${anchor}\` outside a code fence, so ` +
        `${what} is unchecked. Restore the anchor, or delete the check that depends on it.`,
    );
    return [];
  }
  /* More than one match and `findIndex` would silently pick the first, which may introduce a
   * different table entirely. Ambiguity is a failure, not a coin toss. */
  if (occurrences.length > 1) {
    fail(
      `docs/extension-reference.md contains \`${anchor}\` ${occurrences.length} times (lines ` +
        `${occurrences.map((i) => i + 1).join(', ')}), so which table anchors ${what} is ` +
        'ambiguous. Make the anchor unique.',
    );
    return [];
  }
  const at = occurrences[0];

  /* A heading ends the anchor's own section. `#`-style, the setext underlines `===` and `---`,
   * and a thematic break — all three separate sections, and only the first was recognised. */
  const terminator = (index) => {
    const line = lines[index].trimStart();
    if (/^#{1,6}\s/.test(line)) return `heading \`${line.trim()}\``;
    if (/^(\*\s*){3,}$|^(-\s*){3,}$|^(_\s*){3,}$/.test(line)) return 'a thematic break';
    // Setext: an underline under a non-blank line is a heading for that line.
    if (/^(=+|-+)\s*$/.test(line) && index > 0 && lines[index - 1].trim() !== '') {
      return `setext heading \`${lines[index - 1].trim()}\``;
    }
    return null;
  };

  let start = at + 1;
  while (start < lines.length && !lines[start].trimStart().startsWith('|')) {
    const why = terminator(start);
    if (why !== null) {
      fail(
        `docs/extension-reference.md has no table between \`${anchor}\` and ${why}, so ${what} ` +
          'would check nothing.\n' +
          '  An absent table is not an empty one: restore it, or delete the check.',
      );
      return [];
    }
    start += 1;
  }
  if (start >= lines.length) {
    fail(
      `docs/extension-reference.md has no table after \`${anchor}\` at all, so ${what} would check nothing.`,
    );
    return [];
  }

  let end = start;
  while (end < lines.length && lines[end].trimStart().startsWith('|')) end += 1;
  // A header and a separator and nothing else is a legitimately empty table — section 6b is one.
  // Fewer than two lines is not a table at all.
  if (end - start < 2) {
    fail(
      `docs/extension-reference.md has no table header after \`${anchor}\`, only ` +
        `${end - start} line(s) beginning with a pipe, so ${what} would check nothing.`,
    );
    return [];
  }

  /* Line two must BE the separator before two lines are dropped as "the header and its
   * separator". Without this, deleting the header and separator promoted the first two DATA rows
   * into their place and their claims vanished silently — reproduced on the real document. One
   * check covers all three ways the pair can be damaged, because in each case line two is not a
   * separator. */
  const header = splitRow(lines[start]);
  const separatorLine = lines[start + 1].trim();
  if (!/^\|(\s*:?-{3,}:?\s*\|)+$/.test(separatorLine)) {
    fail(
      `docs/extension-reference.md has a table for ${what} whose second line is not a Markdown ` +
        `separator:\n    ${separatorLine.slice(0, 90)}\n` +
        '  Two lines are dropped as the header and its separator, so without that row a data row ' +
        'would be discarded as one and its claim would go unchecked.',
    );
    return [];
  }
  const separatorCells = splitRow(lines[start + 1]);
  if (separatorCells.length !== header.length) {
    fail(
      `docs/extension-reference.md has a table for ${what} whose separator has ` +
        `${separatorCells.length} column(s) and whose header has ${header.length}. A column ` +
        'added to one and not the other shifts every cell this gate reads.',
    );
    return [];
  }

  const rows = [];
  for (let index = start + 2; index < end; index += 1) {
    const cells = splitRow(lines[index]);
    if (cells.length !== header.length) {
      fail(
        `docs/extension-reference.md:${index + 1} is a row of ${what} with ${cells.length} ` +
          `column(s) where the header has ${header.length}:\n    ${lines[index].trim().slice(0, 90)}\n` +
          '  A short or long row shifts the columns this gate reads, so it is a failure rather ' +
          'than a row to skip.',
      );
      continue;
    }
    rows.push({ lineNumber: index + 1, cells, line: lines[index] });
  }
  return rows;
}

/**
 * The slot-state table in section 2.
 *
 * Rows read `| \`slot\` | description | state |`. The state column is prose, so it is
 * classified by the phrases the document itself defines in its "Read the three states
 * precisely" section rather than by a strict enum.
 */
/**
 * Every slot name the **code** declares, read from `EXTENSION_SLOTS`.
 *
 * This is the fix for the class, and it is worth being explicit about why it matters more than
 * any of the parsing above. Until now the gate derived its workload from the document: it read
 * whatever rows it could parse and checked those. A document that lost its table, lost its
 * header, or whose rows stopped matching the row pattern therefore produced **zero** claims and
 * zero findings, and the gate printed "every slot-state claim holds" — three separate review
 * findings, all the same shape.
 *
 * The expected set now comes from the source. A slot declared in code with no readable claim in
 * the document is a failure, so no parsing accident can reduce the work to nothing: it can only
 * turn the run red.
 */
/**
 * The top-level members of an object literal body, split on commas that are not nested.
 *
 * Deliberately structural rather than line- or pattern-based: it is the independent reading that
 * `declaredSlots()` needs, and a second regex sharing the first one's blind spots was not
 * independent at all (PR #555). Comments are already gone — `sources` holds `stripComments()`
 * output — so only nesting and string state have to be tracked.
 */
function objectMembers(inner) {
  const members = [];
  let depth = 0;
  let quote = null;
  let current = '';
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if (quote !== null) {
      current += ch;
      if (ch === '\\') {
        current += inner[i + 1] ?? '';
        i += 1;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    if (ch === ')' || ch === ']' || ch === '}') {
      if (depth === 0) break; // the object's own closing brace
      depth -= 1;
    }
    if (ch === ',' && depth === 0) {
      members.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  members.push(current);
  return members.map((m) => m.trim()).filter(Boolean);
}

function declaredSlots() {
  const file = [...sources.keys()].find((path) => path.endsWith(`${sep}extension-slots.ts`));
  if (!file) {
    fail(
      'Could not find `extension-slots.ts` in non-spec source, so the slot-state table was ' +
        'checked against no expected set. Reading nothing must not pass as finding nothing.',
    );
    return [];
  }
  const body = sources.get(file);
  const open = body.indexOf('export const EXTENSION_SLOTS = {');
  const close = body.indexOf('\n}', open);
  if (open === -1 || close === -1) {
    fail(`${relative(ROOT, file)} has no \`export const EXTENSION_SLOTS = { … }\` block.`);
    return [];
  }
  /**
   * The slot names, read so that an entry this cannot parse cannot shrink the expected set.
   *
   * The pattern required the **value** to be single-quoted — `navbar: 'navbar'` matched,
   * `navbar: "navbar"` did not. That is not cosmetic here: this set is the whole anti-vacuity
   * mechanism, so a slot it misses is a slot whose missing documentation row goes unreported, and
   * the verdict still reads *"cover every slot EXTENSION_SLOTS declares"*. Driven against a
   * fixture: one slot written with a double-quoted value and its row deleted, and the gate exited
   * 0 claiming it covered all of them.
   *
   * Found by applying PR #554's roster finding across the split rather than waiting for it to be
   * reported here — the same class, in the sibling PR, with a worse consequence: there it
   * under-read a roster and hid a missing row; here it under-read the expected set and made the
   * coverage assertion itself vacuous.
   *
   * Any quote style now — and the members are found **structurally**, not by a line pattern.
   *
   * The first fix for this counted "entries" with a second line-anchored regex and compared the
   * two. That cross-check was not independent: both patterns shared the same blind spots, so a
   * member neither could see — a spread, a computed key, or a second entry on the same line — was
   * omitted from *both* counts, they agreed, and the coverage claim was false again. Reported on
   * PR #555, one round after the version it was meant to fix.
   *
   * `objectMembers()` splits the object body on top-level commas, tracking nesting and string
   * state, so it sees every member whatever its shape. A member it cannot read as
   * `key: 'string'` is a **reported failure**, not a member to skip — that is what makes the set
   * complete rather than merely large.
   */
  const block = body.slice(open, close);
  const inner = block.slice(block.indexOf('{') + 1);
  const slots = [];
  /** Key to the member that declared it, so a duplicate can name both. */
  const declaredAt = new Map();
  for (const member of objectMembers(inner)) {
    const parsed = /^(?:['"`]([^'"`]+)['"`]|([A-Za-z_$][\w$]*))\s*:\s*['"`]([^'"`]+)['"`]$/s.exec(
      member,
    );
    if (!parsed) {
      fail(
        `${relative(ROOT, file)} has an \`EXTENSION_SLOTS\` member this gate cannot read as ` +
          `\`key: 'value'\`:\n    ${member.replace(/\s+/g, ' ').slice(0, 90)}\n` +
          '  A member left out of the expected set is a slot whose absent documentation row would ' +
          'go unreported, so an unreadable one is a failure rather than something to skip.',
      );
      return [];
    }
    const key = parsed[1] ?? parsed[2];
    const id = parsed[3];
    /**
     * The key and the value are two different identities, and this gate uses both.
     *
     * The **value** is the slot id: `ExtensionSlotRegistry` keys slots by plain string, so
     * `resolve(EXTENSION_SLOTS.navbar)` resolves `'navbar'` — the value — and that is also what a
     * customer writes in a manifest. The **key** is only how source code spells the reference,
     * and it is what `SLOT_CONST` below greps for when it decides whether a slot is resolved or
     * registered into.
     *
     * While they agree, one name serves both. When they differ, every use of the name is wrong
     * for one of the two purposes, so the gate cannot simply pick one: the documentation row
     * would have to name the value and the resolve/register check would have to grep the key.
     *
     * Only the key was read, and the value discarded. Reported on PR #555 and reproduced before
     * fixing: renaming `navbar: 'navbar'` to `navbar: 'renamedNavbar'` left the gate exiting 0,
     * still claiming it "cover[ed] every slot EXTENSION_SLOTS declares", while the slot the host
     * actually resolves had no row at all. That is the coverage assertion — the one assertion
     * documented as undefeatable — defeated.
     *
     * Reported rather than silently reconciled. All thirteen slots agree today and the file's own
     * comment calls the constants "documentation and typo protection", so divergence is a typo
     * until someone decides otherwise; if it is ever deliberate, this message says exactly which
     * two things have to be taught the difference.
     */
    if (key !== id) {
      fail(
        `${relative(ROOT, file)} declares \`EXTENSION_SLOTS\` member \`${key}\` with the slot id ` +
          `\`${id}\`.\n` +
          `  The registry keys slots by the value, so the host resolves \`${id}\` and a manifest ` +
          `addresses \`${id}\`, but source spells the reference \`EXTENSION_SLOTS.${key}\` and ` +
          "this gate greps for that spelling to decide the slot's state.\n" +
          '  While the two differ one of those is always wrong, so make them agree, or teach the ' +
          'documentation row to use the value and the resolve/register check to use the key.',
      );
      return [];
    }
    /* JavaScript keeps the LAST writer of a duplicate key, so `{ navbar: 'navbar', navbar: 'x' }`
     * registers `x` while a reader — and the expected set built here — sees `navbar` twice and
     * finds its row present. The gate would then pass having compared the documented slot against
     * a slot nothing resolves. The same class as PR #554's roster finding, which is why it is
     * closed here rather than left for the round that would have reported it. */
    if (declaredAt.has(key)) {
      fail(
        `${relative(ROOT, file)} declares the \`EXTENSION_SLOTS\` key \`${key}\` twice.\n` +
          '  JavaScript keeps the last one, so the slot this gate checks is not necessarily the ' +
          'slot the host resolves, and the documentation row for the shadowed one would pass ' +
          'against a slot that no longer exists.',
      );
      return [];
    }
    declaredAt.set(key, id);
    slots.push(id);
  }
  if (slots.length === 0) {
    fail(`${relative(ROOT, file)} yielded no slot names, so the table was compared to nothing.`);
  }
  return slots;
}

/**
 * The slot-state table in section 2.
 *
 * Rows read `| \`slot\` | description | state |`. The state column is prose, so it is classified
 * by the phrases the document itself defines in its "Read the three states precisely" section
 * rather than by a strict enum.
 *
 * **Nothing is skipped.** A row whose slot cell is not a backticked name, and a row whose state
 * prose matches none of the three documented states, are each a failure naming the line. Both
 * used to be dropped silently by `matchAll`, which is how removing the backticks from thirteen
 * slot names left thirteen rows, zero claims and zero findings.
 */
function slotClaims() {
  const claims = [];
  const rows = tableAfter(
    'A slot is a named, ordered list of descriptors.',
    'the slot-state table in section 2',
  );
  for (const { lineNumber, cells, line } of rows) {
    const slotCell = cells[0];
    const stateText = cells[cells.length - 1];
    const named = /^`([^`]+)`$/.exec(slotCell);
    if (!named) {
      fail(
        `docs/extension-reference.md:${lineNumber} is a slot-state row whose first cell is not a ` +
          `backticked slot name:\n    ${line.trim().slice(0, 90)}\n` +
          '  The row cannot be read, so it is a failure rather than a row to skip.',
      );
      continue;
    }
    const state = /nothing resolves it/i.test(stateText)
      ? 'inert'
      : /resolves/i.test(stateText)
        ? 'resolves'
        : /populated/i.test(stateText)
          ? 'populated'
          : null;
    if (state === null) {
      fail(
        `docs/extension-reference.md:${lineNumber} says slot \`${named[1]}\` is ` +
          `"${stateText.slice(0, 70)}", which is none of the three states the document defines ` +
          '("Populated", "Resolves", "nothing resolves it").\n' +
          '  An unclassifiable state was silently dropped before, so the slot went unchecked.',
      );
      continue;
    }
    claims.push({ slot: named[1], state, stateText, lineNumber });
  }

  /* Coverage, from the code. The one assertion that cannot be defeated by anything above. */
  const expected = declaredSlots();
  for (const slot of expected) {
    if (!claims.some((claim) => claim.slot === slot)) {
      fail(
        `\`EXTENSION_SLOTS\` declares the slot \`${slot}\` and section 2 of ` +
          'docs/extension-reference.md has no readable state claim for it.\n' +
          '  A customer reading the table would not know the surface exists.',
      );
    }
  }
  for (const claim of claims) {
    if (expected.length > 0 && !expected.includes(claim.slot)) {
      fail(
        `docs/extension-reference.md:${claim.lineNumber} claims a state for \`${claim.slot}\`, ` +
          'which `EXTENSION_SLOTS` does not declare. The table documents a slot that does not exist.',
      );
    }
  }
  return claims;
}

const SLOT_CONST = (slot) =>
  /^[a-z][a-zA-Z]*$/.test(slot) ? `EXTENSION_SLOTS.${slot}` : `EXTENSION_SLOTS['${slot}']`;

const CLAIMS = slotClaims();

for (const claim of CLAIMS) {
  const token = SLOT_CONST(claim.slot);
  // Registered: the slot appears as a key in a `slots:` contribution or a
  // `register(<slot>, …)` call. Resolved: it appears inside a `resolve(` call.
  const isRegistered = [...sources].some(
    ([, text]) =>
      new RegExp(`\\[${reEscape(token)}\\]\\s*:`).test(text) ||
      new RegExp(`register\\(\\s*${reEscape(token)}`).test(text),
  );
  const isResolved = [...sources].some(([, text]) =>
    new RegExp(`resolve[^)]*${reEscape(token)}`, 's').test(text),
  );

  if (claim.state === 'inert' && isResolved) {
    fail(
      `The reference says slot \`${claim.slot}\` is "${claim.stateText}", but source calls ` +
        `resolve() on it${isRegistered ? ' and registers into it' : ''}.\n` +
        '  This understates the product: a customer would believe the surface is not\n' +
        '  configurable when it is.',
    );
  }
  if (claim.state === 'populated' && !isRegistered) {
    fail(
      `The reference says slot \`${claim.slot}\` is populated, but nothing outside specs ` +
        'registers into it.',
    );
  }
  if (claim.state !== 'inert' && !isResolved) {
    fail(
      `The reference says slot \`${claim.slot}\` is "${claim.stateText}", which promises the ` +
        'host reads it, but no non-spec source calls resolve() on it.',
    );
  }
}

/**
 * Section 6b: the `nxs-` components registered for a slot.
 *
 * Three cells — the registered ID, the element, and the slot a manifest entry places it in — and
 * `npx nx g ./tools/satori-generators:satori-component` appends one per component it adds. Until
 * now **no row could be read at all**: the only regex that looked at this table required a
 * first cell of `` `[a-zA-Z-]+` `` and every ID in it has dots. With zero rows that was invisible.
 *
 * The slot names come out of the generator rather than being listed again here. A fifth slot added
 * there and not here would make every row naming it fail, which is the wrong failure: the document
 * would be red for being correct.
 */
const GENERATOR = join(
  ROOT,
  'tools',
  'satori-generators',
  'src',
  'satori-component',
  'generator.ts',
);
const generatorSource = stripComments(readFileSync(GENERATOR, 'utf8'));
const slotNames = (
  generatorSource.match(/const SLOTS: readonly SatoriComponentSlot\[\] = \[([^\]]*)\]/)?.[1] ?? ''
)
  .split(',')
  .map((s) => s.trim().replace(/^'|'$/g, ''))
  .filter(Boolean);
if (slotNames.length === 0) {
  fail(
    'Could not read `SLOTS` out of the satori-component generator, so the component table was ' +
      'checked against no slot names at all. Reading nothing must not pass as finding nothing.',
  );
}

/**
 * Every `nxs.<slot>.<name>` ID registered in non-spec source, with the class and the file.
 *
 * Scanned across **all** non-spec source, not only `provideNxsComponents()`.
 *
 * The first version read that one provider, because it is the file the generator writes into and
 * the one this section's prose names. Two things were wrong with that, and only the second is
 * what it looked like:
 *
 * 1. The verdict line claimed "no `nxs.<slot>.*` ID is registered" while having looked at one
 *    file — a statement wider than its evidence, which is this gate's own defect class one level
 *    up. Registration is not confined to that provider: the four `nxs.components.*` IDs live in
 *    `apps/nuxeo-ui/src/app/extensions/provide-app-extensions.ts`.
 * 2. **The consequence was a false positive, not a missed gap** — the opposite of what I assumed
 *    when widening it. Driven both ways against a real tree: registering `nxs.tabs.claimSummary`
 *    in `provide-app-extensions.ts` with no row made the narrow version go red anyway, through
 *    the ID-level "registered but absent from the reference" check above. But registering it
 *    there *and* adding its row made the narrow version fail a **correct** tree, reporting
 *    "`provideNxsComponents()` registers no such ID" about an ID that is registered — telling
 *    the author to add a registration that already existed. The widened scan is green on that
 *    tree and red on the genuine gap.
 *
 * `slotNames` comes from the generator, so a fifth slot widens this with it.
 */
const slotIdPattern = String.raw`nxs\.(?:${slotNames.map(reEscape).join('|')})\.[a-zA-Z0-9]+`;
/** @type {Map<string, { className: string, file: string }>} */
const slotRegistered = new Map();
for (const [file, text] of sources) {
  // `'<id>': SomeComponent` — a registry entry. A bare mention of an ID is not a registration.
  for (const match of text.matchAll(
    new RegExp(String.raw`['"\`](${slotIdPattern})['"\`]\s*:\s*(\w+)`, 'g'),
  )) {
    slotRegistered.set(match[1], { className: match[2], file: relative(ROOT, file) });
  }
}

const componentRows = tableAfter(
  'satori:register:nxs-components',
  'the nxs- component table in section 6b',
).map(({ lineNumber, cells, line }) => {
  const unquote = (cell) => (cell ?? '').replace(/^`|`$/g, '');
  return {
    line,
    lineNumber,
    id: unquote(cells[0]),
    element: unquote(cells[1]),
    slot: unquote(cells[2]),
  };
});

for (const row of componentRows) {
  if (!/^nxs\.[a-zA-Z0-9]+\.[a-zA-Z0-9]+$/.test(row.id ?? '')) {
    fail(
      `Section 6b has a row whose first cell is not an \`nxs.<slot>.<name>\` ID: ${row.line.trim()}`,
    );
    continue;
  }
  if (!slotRegistered.has(row.id)) {
    fail(
      `Section 6b lists \`${row.id}\` as registered for a slot, but nothing outside specs ` +
        'registers that ID to a component.\n' +
        '  A customer placing it in a manifest would place nothing.',
    );
  }
  if (!slotNames.includes(row.slot)) {
    fail(
      `Section 6b says \`${row.id}\` is for the slot \`${row.slot}\`, which is not one of the ` +
        `slots whose descriptors name a component: ${slotNames.join(', ')}.`,
    );
  }
  /* The element must be the selector of **the class registered for this row's ID**, not merely a
   * selector that exists somewhere.
   *
   * It used to be the latter — `selector: '<element>'` tested against all source — and that
   * accepted any row whose element named any component in the repository. My own break test for
   * this gate proved it and I did not notice: the row
   * `| nxs.tabs.claimSummary | nxs-card | nonsenseSlot |` produced exactly one finding, about the
   * slot, while `nxs-card` belonged to a completely different component. Review named it on
   * PR #544. The element column is how a reader knows what to put in their template, so a wrong
   * one that passes is a documented lie. */
  const registration = slotRegistered.get(row.id);
  if (registration) {
    /* The file that REGISTERS the ID usually only imports the class; the `@Component` decorator
     * is wherever the class is declared. Looking in the registering file found nothing and failed
     * both the wrong-element case and the correct one — a false positive I caught by requiring
     * the positive control to pass before replying to the review. */
    const selector = selectorOf(registration.className, registration.file);
    if (!selector) {
      fail(
        `Section 6b gives \`${row.id}\` the element \`${row.element}\`, and no non-spec source ` +
          `declares \`${registration.className}\` with a selector, so the element column is ` +
          'unverified. Do not leave it asserted-but-unchecked.',
      );
    } else if (selector !== row.element) {
      fail(
        `Section 6b gives \`${row.id}\` the element \`${row.element}\`, but the component ` +
          `registered for it — \`${registration.className}\` in ${registration.file} — declares ` +
          `\`${selector}\`.\n` +
          '  A reader copying that element into a template would write the wrong tag.',
      );
    }
  }
}

/**
 * The `selector` of one component class, found wherever that class is declared.
 *
 * Searches every non-spec source for `export class <className>`, because the file that registers
 * an ID is rarely the file that declares the component. Angular puts
 * `@Component({ selector: '…' })` immediately above the class, so the selector wanted is the last
 * one declared before it.
 *
 * Returns `null` when it cannot be read, and the caller **fails** rather than passing: an
 * unreadable selector is an unverified column, not a matching one.
 *
 * @param {string} className
 * @returns {string | null}
 */
/**
 * `{ a, b as c, type d }` as the bindings it declares, named from the clause's own point of view.
 *
 * `inner` is the name this file uses or exposes; `outer` is the name the other module provides.
 * The mapping is the same for an import and for a re-export, which is why one parser serves both:
 *
 * - `import { X as Y } from 'm'` — this file uses `Y`, `m` provides `X`.
 * - `export { X as Y } from 'm'` — this file exposes `Y`, `m` provides `X`.
 *
 * Parsed rather than substring-matched because substring matching was wrong in both directions,
 * and both were reported on PR #555. For a barrel with
 * `export { FxCardComponent as AlternateCardComponent } from './a'` and
 * `export { FxCardComponent } from './b'`, a search for `\bFxCardComponent\b` inside the braces
 * matched the **first** clause — the aliased one — and resolved to the wrong module, so the gate
 * accepted the wrong element and rejected the correct one. And for
 * `export { OriginalCardComponent as FxCardComponent } from './a'`, it resolved the module and
 * then looked for `export class FxCardComponent` there, found nothing, and fell through to a
 * global search that accepted an unrelated class of that name. A unique global name is not proof
 * of identity.
 */
function parseBindings(clause) {
  return clause
    .split(',')
    .map((part) =>
      part
        .trim()
        .replace(/^type\s+/, '')
        .trim(),
    )
    .filter(Boolean)
    .map((part) => {
      const renamed = /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/.exec(part);
      if (renamed) return { outer: renamed[1], inner: renamed[2] };
      return /^[A-Za-z_$][\w$]*$/.test(part) ? { outer: part, inner: part } : null;
    })
    .filter(Boolean);
}

/**
 * The selector of the component a given binding name refers to, in a given file.
 *
 * Follows renames: a re-export whose exposed name matches is followed under the name the target
 * module actually provides. When a binding is known to come from elsewhere and that elsewhere
 * cannot be resolved, it returns `null` so the caller refuses — it does **not** fall through to a
 * name match, because the whole point of following the binding is that the name alone is not
 * identity.
 */
function selectorOfBinding(name, file, depth = 0) {
  const text = sources.get(file);
  if (text === undefined) return null;

  /* A module's `export default`, reached by a default import. `DEFAULT` is the pseudo-name the
   * caller passes for it, because a default export has no name of its own at the import site —
   * which is exactly why a default import cannot be resolved by name and must be followed. */
  if (name === DEFAULT_BINDING) {
    const declared = /export\s+default\s+class\s+([A-Za-z_$][\w$]*)/.exec(text);
    if (declared) return selectorOfBinding(declared[1], file, depth);
    const reexported = /export\s+default\s+([A-Za-z_$][\w$]*)\s*;/.exec(text);
    if (reexported) return selectorOfBinding(reexported[1], file, depth);
    // `export default class { … }` with its decorator above it: read the nearest selector.
    const anonymous = text.search(/export\s+default\s+class\s*[{<]/);
    if (anonymous !== -1) {
      const selectors = [...text.slice(0, anonymous).matchAll(/selector:\s*['"`]([^'"`]+)['"`]/g)];
      return selectors.length === 0 ? null : selectors[selectors.length - 1][1];
    }
    return null;
  }

  /* Any declaration form, exported at the declaration or not — see `classDeclaration`. Reached
   * from the default-export branch above, which recurses with the declared name, and from a
   * re-export clause, both of which can land on a class the file never marks `export`. */
  const classAt = text.search(classDeclaration(name));
  if (classAt !== -1) {
    const selectors = [...text.slice(0, classAt).matchAll(/selector:\s*['"`]([^'"`]+)['"`]/g)];
    return selectors.length === 0 ? null : selectors[selectors.length - 1][1];
  }
  // Two hops is a barrel re-exporting a barrel; beyond that, refuse rather than crawl.
  if (depth >= 2) return null;

  for (const clause of text.matchAll(
    /export\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"`]([^'"`]+)['"`]/g,
  )) {
    const binding = parseBindings(clause[1]).find((b) => b.inner === name);
    if (!binding) continue;
    const target = resolveModule(clause[2], relative(ROOT, file));
    // The binding was found and its module was not: refuse rather than guess.
    return target ? selectorOfBinding(binding.outer, target, depth + 1) : null;
  }

  // `export * from './x'` — the name is unchanged, so try each and take the first that declares it.
  for (const star of text.matchAll(/export\s*\*\s*from\s*['"`]([^'"`]+)['"`]/g)) {
    const target = resolveModule(star[1], relative(ROOT, file));
    const found = target && selectorOfBinding(name, target, depth + 1);
    if (found) return found;
  }
  return null;
}

function selectorOf(className, registeringFile) {
  /* The same definition the binding lookup uses, for the reason `classDeclaration` records: this
   * site counts declarers for the ambiguity refusal below, where missing a declaration is the
   * more dangerous direction of the two — a class the pattern cannot see is a declarer that does
   * not count, so the refusal never fires and another file's selector is accepted as identity. */
  const declaration = classDeclaration(className);

  const registering = sources.get(join(ROOT, registeringFile));
  if (registering !== undefined) {
    /* Declared in the file that registers it: no binding to follow. Checked first, because a
     * local declaration is unambiguous and cheaper than resolving a module. */
    const own = selectorOfBinding(className, join(ROOT, registeringFile));
    if (own) return own;

    /* A default import of this class: `import ClassName from 'm'`. Matched before the named
     * clauses because the two are different bindings that can coexist in one file.
     *
     * The companion clause after the comma is skipped rather than parsed, and it is either form
     * the grammar allows — `, { … }` or `, * as ns` — because the sought name is the default
     * binding here and what accompanies it changes nothing. The namespace alternative is the
     * mirror of the combined-clause hole found in the named matcher below: the same statement
     * shape, the other binding position. */
    const defaultImport = new RegExp(
      String.raw`import\s+${reEscape(className)}\s*(?:,\s*(?:\{[^}]*\}|\*\s+as\s+[A-Za-z_$][\w$]*))?\s*from\s*['"\`]([^'"\`]+)['"\`]`,
    ).exec(registering);
    if (defaultImport) {
      const target = resolveModule(defaultImport[1], registeringFile);
      if (!target) {
        fail(
          `\`${className}\` is default-imported into ${registeringFile} from ` +
            `\`${defaultImport[1]}\`, which could not be resolved, so which component it refers ` +
            'to is unknown. A class of that name found elsewhere would not be proof of identity.',
        );
        return null;
      }
      const selector = selectorOfBinding(DEFAULT_BINDING, target);
      if (selector) return selector;
      fail(
        `\`${className}\` is default-imported into ${registeringFile} from ` +
          `\`${defaultImport[1]}\`, and no selector could be read for that module's default ` +
          'export. A default import has no exported name, so it cannot be resolved by name — ' +
          'this is reported rather than guessed.',
      );
      return null;
    }

    /**
     * The named clause, after an optional default binding.
     *
     * `import Helper, { ActualComponent as FxCardComponent } from './actual'` is one clause with
     * two bindings, and the pattern required the brace to follow `import` directly, so the whole
     * clause was invisible. Neither matcher saw it — the default matcher above is looking for the
     * sought name in the default position, and here it is in the braces — so resolution fell
     * through to the global fallback and matched an unrelated exported namesake.
     *
     * Reported on PR #555 and reproduced in both directions before fixing, which is the part that
     * makes it serious: the fixture exited **0** for the namesake's wrong selector and exited 1
     * for the registered component's real one. A silent wrong acceptance and a false rejection
     * from the same hole.
     */
    for (const clause of registering.matchAll(
      /import\s*(?:type\s*)?(?:[A-Za-z_$][\w$]*\s*,\s*)?\{([^}]*)\}\s*from\s*['"`]([^'"`]+)['"`]/g,
    )) {
      const binding = parseBindings(clause[1]).find((b) => b.inner === className);
      if (!binding) continue;
      const target = resolveModule(clause[2], registeringFile);
      if (!target) {
        fail(
          `\`${className}\` is imported into ${registeringFile} from \`${clause[2]}\`, which ` +
            'could not be resolved, so which component it refers to is unknown. A class of that ' +
            'name found elsewhere would not be proof of identity.',
        );
        return null;
      }
      const selector = selectorOfBinding(binding.outer, target);
      if (selector) return selector;
      fail(
        `\`${className}\` is imported into ${registeringFile} from \`${clause[2]}\`` +
          `${binding.outer === className ? '' : ` as \`${binding.outer}\``}, and no selector ` +
          'could be read for it there. Following the binding is what identifies the component, ' +
          'so this is reported rather than resolved by name.',
      );
      return null;
    }
  }

  /* Fallback: a global search by class name — but **ambiguity is a refusal**, not a coin toss.
   *
   * Class names are not unique across this repository: `SearchComponent` is declared twice, as
   * `app-search` in `apps/nuxeo-satori-template` and `lib-search` in `libs/features/search`.
   * Taking the first match returned `lib-search`, so a row correctly naming `app-search` would
   * have been rejected and a row wrongly naming `lib-search` accepted. Found by review on
   * PR #544; the two declarations and the first-match result were both confirmed before fixing. */
  const declaring = [...sources.keys()].filter((file) => declaration.test(sources.get(file)));
  if (declaring.length > 1) {
    fail(
      `\`${className}\` is declared in ${declaring.length} non-spec files — ` +
        `${declaring.map((f) => relative(ROOT, f)).join(', ')} — and the import in ` +
        `${registeringFile} could not be resolved, so which component's selector to compare is ` +
        'ambiguous. An ambiguous answer is not a verified one.',
    );
    return null;
  }
  /* `selectorOfBinding`, not the `readFrom` closure this used to call — that closure was replaced
   * when the resolution chain was rewritten and this line was left pointing at it, so the one path
   * that reaches the fallback with a unique name threw `ReferenceError: readFrom is not defined`
   * and rejected a valid component. The path is narrow (a default import, which the named-import
   * matcher cannot see, of a class no other file declares) which is why nothing else hit it.
   * Reported on PR #555; reproduced before fixing, and the positive control for this fallback is
   * what the existing ambiguity control did not cover. */
  return declaring.length === 1 ? selectorOfBinding(className, declaring[0]) : null;
}

/**
 * A module specifier resolved to a file this gate has already read, or `null`.
 *
 * Handles a relative path and a `tsconfig.base.json` path alias, with `.ts` and `/index.ts`
 * tried in that order. Deliberately not a general module resolver: anything it cannot resolve
 * falls through to the ambiguity check above, which refuses rather than guessing.
 */
function resolveModule(specifier, fromFile) {
  const candidates = [];
  if (specifier.startsWith('.')) {
    const base = resolve(ROOT, fromFile, '..', specifier);
    candidates.push(`${base}.ts`, join(base, 'index.ts'));
  } else {
    /* An alias specifier with no readable `paths` map is reported, not shrugged off. Returning
     * `{}` on an unreadable `tsconfig.base.json` would have made alias resolution quietly stop
     * working and every aliased component fall through to the ambiguity refusal — a capability
     * lost in silence, which is the defect class this whole gate exists for. */
    if (TSCONFIG_PATHS === null) {
      fail(
        `Could not read \`compilerOptions.paths\` from tsconfig.base.json, so the import ` +
          `\`${specifier}\` in ${fromFile} cannot be resolved and the component's selector is ` +
          'unverified. Fix the tsconfig rather than letting alias resolution fail quietly.',
      );
      return null;
    }
    for (const [alias, targets] of Object.entries(TSCONFIG_PATHS)) {
      const prefix = alias.replace(/\*$/, '');
      if (!specifier.startsWith(prefix)) continue;
      const rest = specifier.slice(prefix.length);
      for (const target of targets) {
        const base = resolve(ROOT, target.replace(/\*$/, '') + rest);
        candidates.push(base, `${base}.ts`, join(base, 'index.ts'));
      }
    }
  }
  return candidates.find((candidate) => sources.has(candidate)) ?? null;
}

for (const [id, { className, file }] of slotRegistered) {
  if (!componentRows.some((row) => row.id === id)) {
    fail(
      `\`${id}\` (${className}, registered in ${file}) is registered for a slot and has no row ` +
        'in section 6b.\n' +
        '  An addressable component a customer cannot discover is not addressable.',
    );
  }
}

/**
 * The empty case, stated rather than assumed.
 *
 * The table is empty today and that is **correct**: every `nxs.` ID the product registers is a
 * `nxs.primitives.*` placed by a host that resolves it, or one of the four `nxs.components.*`
 * panels and pages that section 6 lists; nothing has yet been generated for `sidebar`, `tabs`,
 * `documentView` or `routes`. The distinction this gate could not previously draw is between that
 * and a table somebody emptied, so the empty case now asserts the reason instead of passing by
 * having found no rows to check.
 */
const emptyTableNote =
  componentRows.length === 0
    ? `section 6b is empty, and no \`nxs.{${slotNames.join(',')}}.*\` ID is registered, so it is correctly empty`
    : `${componentRows.length} row(s) in section 6b, each registered and placeable`;

if (failures.length) {
  console.error(`\nextension-reference-drift: FAIL — ${failures.length} problem(s)\n`);
  for (const message of failures) console.error(`- ${message}\n`);
  console.error(
    'This document is the customer contract. Fix the document, or fix the code, but do\n' +
      'not leave them disagreeing.\n',
  );
  process.exit(1);
}

console.log(
  `extension-reference-drift: pass — ${documented.size} documented ID(s) all registered, ` +
    `${registered.size} registered ID(s) all documented, all ${CLAIMS.length} slot-state ` +
    `claim(s) hold and cover every slot EXTENSION_SLOTS declares, and ` +
    `${emptyTableNote}.`,
);
