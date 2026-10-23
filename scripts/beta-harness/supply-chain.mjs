#!/usr/bin/env node
/**
 * Supply-chain gate — SCA with teeth, and a dependency-surface check.
 *
 * ## Why `npm audit` alone was not a gate
 *
 * The Beta checklist asks for SCA. What existed was a human running `npm audit` and writing the
 * number into a document — which is a measurement, not a gate. Three things were missing:
 *
 * 1. **Nothing failed.** A `high` appearing in a production dependency tomorrow would be recorded
 *    in the next document someone happened to write.
 * 2. **`npm audit` alone is the wrong denominator.** The full audit reports 9 high and 13 moderate;
 *    every one is in **dev** tooling that never reaches a customer. Gating on that total would be
 *    red permanently, and a gate that cannot pass gets bypassed and then ignored — the same
 *    reasoning behind the coverage ratchet. Gating on `--omit=dev` is the honest denominator, and
 *    the dev total is *reported* here so it cannot be quietly forgotten either.
 * 3. **Accepting a finding had no expiry.** "It's only a low" is a decision, and an undated
 *    decision becomes a permanent one. Allowlist entries need a reason and a date, and expire.
 *
 * ## The dependency-surface check
 *
 * The fourth check exists because of what it found: **four production dependencies that nothing
 * imported** — `openai`, `express`, `cors` and `dotenv`. Two were already recorded as debt; `cors`
 * and `dotenv` were not, and were found by this check.
 *
 * That is not tidiness. `openai` in `dependencies` is the single clearest reason a reader concludes
 * this application makes direct LLM calls — it does not; the AI features are Nuxeo Automation
 * operations — and every unused production dependency is audit surface, licence surface and
 * supply-chain surface for no benefit.
 *
 * The check needs an exception list because a package can be genuinely required and never appear in
 * an import: Angular's runtime needs `tslib` and `@angular/animations`, and the rest are left over
 * from ADF, which left the tree in NXSAT-637 — version pins for `@alfresco/adf-core`'s peers, and
 * the `ng-mocks` stub adf-hx needed. NXSAT-672 removes them. Every exception
 * carries a reason, and an exception that stops being needed fails the check as unnecessary — so
 * the list cannot rot into a place where things are hidden.
 *
 * Usage:
 *   node scripts/beta-harness/supply-chain.mjs
 *   node scripts/beta-harness/supply-chain.mjs --json
 *   node scripts/beta-harness/supply-chain.mjs --today 2027-01-01   # test allowlist expiry
 *
 * Exit 1 on a production high/critical, an unallowlisted or expired production finding, an
 * unreferenced production dependency, an exception that is no longer needed, or an acceptance
 * whose cited mitigation no longer exists in the code it names.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { CONTROL_COUNT, collectReferences, referenced, selfCheck } from './module-references.mjs';
import {
  CONTROL_COUNT as SCAN_CONTROL_COUNT,
  selfCheck as scanSelfCheck,
} from './stylesheet-scan.mjs';

const repoRoot = resolve(import.meta.dirname, '..', '..');
const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const todayArg = argv[argv.indexOf('--today') + 1];
const today =
  argv.includes('--today') && todayArg ? todayArg : new Date().toISOString().slice(0, 10);

const allowlistPath = resolve(repoRoot, '.ai/state/supply-chain-allowlist.json');
const allowlist = existsSync(allowlistPath)
  ? JSON.parse(readFileSync(allowlistPath, 'utf8'))
  : { advisories: {}, unreferencedDependencies: {} };

/** Severities that fail outright in a production tree, allowlist or not. */
const BLOCKING = ['critical', 'high'];

const problems = [];
const notes = [];
const fail = (msg) => problems.push(msg);

/* ------------------------------------------------------------------ 1 & 2. SCA ---- */

/** @param {string[]} args */
function audit(args) {
  const res = spawnSync('npm', ['audit', '--json', ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  // `npm audit` exits non-zero when it finds anything, so the exit code says nothing about
  // whether it worked. Parse failure is the real error, and it must not be read as "clean".
  try {
    return JSON.parse(res.stdout);
  } catch {
    return null;
  }
}

const prod = audit(['--omit=dev']);
const full = audit([]);

if (!prod) {
  fail(
    'npm audit --omit=dev produced no parseable JSON, so no scan happened. Refusing to report a ' +
      'pass on a measurement that did not run.',
  );
}

const prodCounts = prod?.metadata?.vulnerabilities ?? {};
const fullCounts = full?.metadata?.vulnerabilities ?? {};

/**
 * The GHSA identifiers an audit finding actually cites, read out of its advisory URLs, deduplicated.
 *
 * This exists because keying an acceptance by package name alone let a wrong one pass unnoticed. The
 * `quill` entry cited `GHSA-4943-9vgg-gr5r`, a 2021 advisory affecting `quill <= 1.3.7`, while the
 * installed version was 2.0.3 — so the advisory that actually applied had never been reviewed, and
 * this gate reported the acceptance as satisfied every run because the package name matched. Reading
 * the identifier is what turns "something about quill was once accepted" into "this advisory was".
 *
 * Returns the ids AND a count of advisory objects it could not identify. The count is the load-bearing
 * half: dropping an unrecognisable entry silently would let a finding that cites a recognised GHSA
 * alongside, say, a bare CVE URL satisfy both the "no ids at all" guard and set equality, while the
 * second advisory had never been accepted. An advisory this function cannot name is a reason to fail,
 * not a value to discard.
 */
function ghsaIdsOf(v) {
  const ids = [];
  let unidentifiable = 0;
  for (const entry of v.via ?? []) {
    if (typeof entry === 'string') continue; // a package name, not an advisory
    const match =
      typeof entry?.url === 'string'
        ? /(GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4})/i.exec(entry.url)
        : null;
    if (match) ids.push(match[1].toUpperCase());
    else unidentifiable += 1;
  }
  return { ids: [...new Set(ids)].sort(), unidentifiable };
}

/**
 * @type {{name: string, severity: string, title: string, url: string|null,
 *         ghsas: string[], unidentifiableAdvisories: number, range: string|null}[]}
 */
const prodFindings = [];
for (const [name, v] of Object.entries(prod?.vulnerabilities ?? {})) {
  const titles = (v.via ?? []).map((x) => (typeof x === 'string' ? x : x.title)).filter(Boolean);
  const { ids, unidentifiable } = ghsaIdsOf(v);
  prodFindings.push({
    name,
    severity: v.severity,
    title: titles[0] ?? 'no advisory title',
    url: (v.via ?? []).find((x) => typeof x !== 'string')?.url ?? null,
    ghsas: ids,
    unidentifiableAdvisories: unidentifiable,
    range: typeof v.range === 'string' ? v.range : null,
  });
}

// Check 1 — nothing high or critical ships.
const blocking = prodFindings.filter((f) => BLOCKING.includes(f.severity));
for (const f of blocking) {
  fail(
    `production dependency ${f.name} has a ${f.severity} advisory: ${f.title}. ` +
      'high and critical are not allowlistable — fix, upgrade, or remove the dependency.',
  );
}

// Check 2 — everything else needs a dated, unexpired justification.
const nonBlocking = prodFindings.filter((f) => !BLOCKING.includes(f.severity));
for (const f of nonBlocking) {
  const entry = allowlist.advisories?.[f.name];
  if (!entry) {
    fail(
      `production dependency ${f.name} has a ${f.severity} advisory (${f.title}) with no entry in ` +
        `${relative(allowlistPath)}. Add one with a reason and an expiry, or remove the dependency.`,
    );
    continue;
  }
  if (!entry.reason || !entry.expires) {
    fail(`allowlist entry for ${f.name} needs both "reason" and "expires" (YYYY-MM-DD).`);
    continue;
  }
  // The acceptance must name the advisory it accepts, and that identifier must be one the audit
  // reports. Without this the entry accepts a package rather than a finding, so a later, different
  // advisory against the same package inherits an approval nobody gave it.
  if (!entry.advisory) {
    fail(
      `allowlist entry for ${f.name} needs an "advisory" field naming the GHSA it accepts. ` +
        `The audit reports ${f.ghsas.length ? f.ghsas.join(', ') : 'no identifiable GHSA'}. ` +
        'Accepting a package name rather than an advisory is how a stale acceptance survives.',
    );
    continue;
  }
  if (!f.ghsas.length) {
    // Fail closed. If the identifier cannot be read there is nothing to compare, and treating that
    // as a pass would restore exactly the hole this check exists to close.
    fail(
      `the allowlist accepts ${entry.advisory} for ${f.name}, but no GHSA id could be read from the ` +
        'audit output, so the acceptance cannot be verified against the reported advisory.',
    );
    continue;
  }
  // An advisory the reader could not name is not the same as one that is absent. Without this, a
  // finding citing a recognised GHSA next to an unrecognisable URL would satisfy both the guard above
  // and the set equality below, while the second advisory had never been reviewed at all.
  if (f.unidentifiableAdvisories > 0) {
    fail(
      `the audit reports ${f.unidentifiableAdvisories} advisory object(s) for ${f.name} with no ` +
        `readable GHSA id, alongside ${f.ghsas.join(', ')}. The acceptance cannot be shown to cover ` +
        'them, so it is treated as unverified rather than partial.',
    );
    continue;
  }
  // Set EQUALITY, not membership. `includes` would pass while a second advisory sat unreviewed
  // beside the accepted one, which is the same package-level approval this check exists to remove —
  // just one advisory later. `advisory` therefore takes a list when a package genuinely has more
  // than one accepted finding, and every reported id must be named.
  const accepted = [
    ...new Set((Array.isArray(entry.advisory) ? entry.advisory : [entry.advisory]).map(String)),
  ]
    .map((id) => id.toUpperCase())
    .sort();
  const unaccepted = f.ghsas.filter((id) => !accepted.includes(id));
  const unreported = accepted.filter((id) => !f.ghsas.includes(id));
  if (unaccepted.length || unreported.length) {
    fail(
      `the allowlist accepts ${accepted.join(', ')} for ${f.name}, but the audit reports ` +
        `${f.ghsas.join(', ')}.` +
        (unaccepted.length
          ? ` Not accepted: ${unaccepted.join(', ')} — needs its own review.`
          : '') +
        (unreported.length ? ` Accepted but not reported: ${unreported.join(', ')}.` : '') +
        ' Every reported advisory must be named, or a new one inherits an approval nobody gave it.',
    );
    continue;
  }
  // Recording the affected range makes the acceptance specific to the version actually installed, so
  // an upgrade into a newly-affected range cannot pass under a review of the old one.
  //
  // Keyed on PRESENCE, not truthiness. `entry.affects && …` skipped both checks for an explicitly
  // supplied `""`, so a malformed entry read as "no range claimed" and passed — the field silently
  // opting out of its own verification. Presence also means a supplied value must be usable: a
  // non-string or an empty string is a broken entry, and a broken entry fails.
  if (Object.hasOwn(entry, 'affects')) {
    if (typeof entry.affects !== 'string' || entry.affects.trim() === '') {
      fail(
        `the allowlist entry for ${f.name} supplies "affects" but its value is not a non-empty ` +
          `string (got ${JSON.stringify(entry.affects)}). Remove the field or give it the range the ` +
          'audit reports.',
      );
      continue;
    }
    // Supplying `affects` and finding no range to compare is a failure, not a pass: the audit shape
    // changing is exactly when an unverified acceptance is most dangerous.
    if (f.range === null) {
      fail(
        `the allowlist accepts ${f.name} for versions "${entry.affects}", but the audit reported no ` +
          'range to compare against, so the acceptance cannot be verified against what is installed.',
      );
      continue;
    }
    if (entry.affects !== f.range) {
      fail(
        `the allowlist accepts ${f.name} for versions "${entry.affects}", but the audit reports ` +
          `"${f.range}". Re-review against the installed version.`,
      );
      continue;
    }
  }
  if (entry.expires < today) {
    fail(
      `the allowlist entry for ${f.name} expired on ${entry.expires} (today is ${today}). ` +
        'Re-review it: is the advisory still unreachable, and is the dependency still needed?',
    );
    continue;
  }
  notes.push(
    `${f.name} (${f.severity}) accepted until ${entry.expires}: ${entry.reason.slice(0, 120)}`,
  );
}

// Allowlist entries for advisories that no longer exist are stale reassurance — the same defect
// the coverage gate's orphan check exists for.
for (const name of Object.keys(allowlist.advisories ?? {})) {
  if (!prodFindings.some((f) => f.name === name)) {
    fail(
      `the allowlist accepts an advisory for ${name}, but the production audit no longer reports ` +
        'one. Remove the entry — a standing acceptance of a fixed problem reads as coverage it ' +
        'does not provide.',
    );
  }
}

// Check 3 — the dev total, reported and explicitly not gated.
notes.push(
  `dev-inclusive audit: ${fullCounts.critical ?? 0} critical, ${fullCounts.high ?? 0} high, ` +
    `${fullCounts.moderate ?? 0} moderate, ${fullCounts.low ?? 0} low — REPORTED, NOT GATED. ` +
    'These are build-time only and do not reach a customer. They are still worth reducing.',
);

/* ------------------------------------------------- 4. production dependency surface ---- */

const pkg = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'));
const prodDeps = Object.keys(pkg.dependencies ?? {});

/**
 * Specifiers are parsed rather than pattern-matched, so a comment or prose cannot count as an
 * import. See `module-references.mjs` for what counts and why.
 */
const refs = collectReferences(repoRoot);

const controlFailures = selfCheck();
for (const failure of controlFailures) fail(`module-reference control failed — ${failure}`);
if (controlFailures.length === 0) {
  notes.push(
    `module-reference controls: ${CONTROL_COUNT.negative} negative (must not count) + ` +
      `${CONTROL_COUNT.positive} positive (must count), all as specified.`,
  );
}
const scanFailures = scanSelfCheck();
for (const failure of scanFailures) fail(`stylesheet-scan control failed — ${failure}`);
if (scanFailures.length === 0) {
  notes.push(
    `stylesheet-scan controls: ${SCAN_CONTROL_COUNT.mask} mask (exact output) + ` +
      `${SCAN_CONTROL_COUNT.negative} negative (must find nothing) + ` +
      `${SCAN_CONTROL_COUNT.positive} positive (must find exactly these), all as specified.`,
  );
}

const unreferenced = prodDeps.filter((d) => !referenced(d, refs));
const exceptions = allowlist.unreferencedDependencies ?? {};

for (const dep of unreferenced) {
  const reason = exceptions[dep];
  if (!reason) {
    fail(
      `production dependency ${dep} is referenced nowhere in apps/, libs/, tools/, scripts/ or ` +
        'angular.json. If it is genuinely required at runtime or to pin a peer, add it to ' +
        `"unreferencedDependencies" in ${relative(allowlistPath)} with the reason. Otherwise ` +
        'remove it: unused production dependencies are audit, licence and supply-chain surface ' +
        'for no benefit.',
    );
  } else {
    notes.push(`${dep} unreferenced but required: ${reason.slice(0, 110)}`);
  }
}

// An exception for a dependency that is now referenced, or gone, is a rule protecting nothing.
for (const dep of Object.keys(exceptions)) {
  if (!prodDeps.includes(dep)) {
    fail(
      `"unreferencedDependencies" names ${dep}, which is not a production dependency. Remove it.`,
    );
  } else if (referenced(dep, refs)) {
    fail(
      `"unreferencedDependencies" excuses ${dep}, but it IS referenced in the source now. Remove ` +
        'the exception so the check applies to it again.',
    );
  }
}

/* ------------------------------------------- 5. the cited mitigations still exist ---- */

/**
 * Does the code an acceptance points at still exist, and does it still contain the guard?
 *
 * ## Why
 *
 * An acceptance's prose carries its whole argument and nothing verified a word of it. The `quill`
 * entry has been re-reviewed four times and every pass found at least one source pointer stale —
 * naming an unrelated line, or sanitised code sitting in a branch the advisory cannot reach. By the
 * fifth review three of its four pointers had drifted again: the `DOMPurify` call it cited at
 * 502-503 had moved to 525-526, and 502 had become an unrelated method signature. `advisory` and
 * `affects` moved part of the entry's burden onto this gate; this moves the source pointers too.
 *
 * Line numbers are the part that rots, because they shift whenever anyone inserts a method above
 * them and nothing complains. So an entry cites a `declaration` — the literal text of the
 * declaration line — plus an optional `guard` that must appear inside that declaration's body.
 *
 * ## What this does NOT do
 *
 * It does not check that the claim is true. It checks that the code the claim names still exists
 * and still contains the mitigation it credits. A reviewer must still read the argument; what they
 * no longer have to do is work out whether the pointers were ever right in the first place.
 *
 * ## Why this parses instead of counting braces
 *
 * The first version of this check found the anchor with `indexOf`, matched braces by counting
 * them, and tested the guard with `includes` on the raw text. Review found two holes in it, and
 * the second was demonstrated rather than argued: **commenting out** `DOMPurify.sanitize(...)`
 * left the gate green, because the guard string was still present — in a comment. That is not a
 * contrived input, it is what removing a line during a refactor actually looks like, and it is
 * precisely the regression this check exists to catch. The first hole was the same shape: a `{`
 * inside a string literal unbalances a brace counter, so the "body" runs on past the end of the
 * function and an unrelated later occurrence of the guard satisfies it.
 *
 * So the file is parsed. The body comes from the AST, and the guard is matched against source
 * with comments and literals blanked out.
 *
 * ## Consequences worth knowing before you write an entry
 *
 * - **A `guard` must be executable code**, because the text it is matched against has string and
 *   template literals blanked. `expect(x).not.toContain(` is a usable guard; `'<script'` is not.
 * - **An anchor may contain a string literal** — `it('…', () => {` has to work — so anchors are
 *   matched against source with only comments blanked. An anchor therefore cannot resolve to a
 *   declaration quoted inside a doc comment, which matters in a repository whose comments quote
 *   code as often as this one's do.
 *
 * ## Fail-closed choices, each for a reason
 *
 * - The anchor must be UNIQUE in the file. A bare symbol name is not enough: `readQuillHtml`
 *   appears three times in note-editor.ts, twice as a call, so anchoring on the first occurrence
 *   would resolve a *caller's* body and hunt for the guard in the wrong function.
 * - An anchor that resolves to no function body fails rather than being skipped.
 * - `mitigations` is optional, exactly as `affects` is: an acceptance can legitimately rest on
 *   something with no code to point at. But a field that is PRESENT must be a non-empty array of
 *   usable entries, so it cannot quietly opt out of its own verification.
 */

/**
 * `text` with every range in `ranges` replaced by spaces, preserving length and line structure so
 * offsets stay usable.
 *
 * @param {string} text
 * @param {[number, number][]} ranges
 */
function blankOut(text, ranges) {
  if (ranges.length === 0) return text;
  const chars = text.split('');
  for (const [start, end] of ranges) {
    for (let i = Math.max(0, start); i < Math.min(end, chars.length); i += 1) {
      if (chars[i] !== '\n' && chars[i] !== '\r') chars[i] = ' ';
    }
  }
  return chars.join('');
}

/**
 * Every comment range in the file, taken from the parser rather than a scanner.
 *
 * A raw scanner mis-tokenises a regex containing an escaped slash and can then report part of it
 * as a comment, which would blank real code and fail an honest entry.
 *
 * @param {ts.SourceFile} sourceFile
 * @param {string} text
 * @returns {[number, number][]}
 */
function commentRanges(sourceFile, text) {
  /** @type {[number, number][]} */
  const ranges = [];
  const visit = (node) => {
    for (const r of ts.getLeadingCommentRanges(text, node.getFullStart()) ?? []) {
      ranges.push([r.pos, r.end]);
    }
    for (const r of ts.getTrailingCommentRanges(text, node.getEnd()) ?? []) {
      ranges.push([r.pos, r.end]);
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return ranges;
}

/**
 * Every string, template and regex literal range inside `node`.
 *
 * A template expression blanks only its literal spans, so a guard inside `${…}` still counts as
 * code — blanking the whole template would fail honest entries.
 *
 * @param {ts.Node} node
 * @param {ts.SourceFile} sourceFile
 * @returns {[number, number][]}
 */
function literalRanges(node, sourceFile) {
  /** @type {[number, number][]} */
  const ranges = [];
  const visit = (n) => {
    if (ts.isStringLiteralLike(n) || ts.isRegularExpressionLiteral(n)) {
      ranges.push([n.getStart(sourceFile), n.getEnd()]);
      return;
    }
    if (ts.isTemplateExpression(n)) {
      ranges.push([n.head.getStart(sourceFile), n.head.getEnd()]);
      for (const span of n.templateSpans) {
        ranges.push([span.literal.getStart(sourceFile), span.literal.getEnd()]);
        visit(span.expression);
      }
      return;
    }
    n.forEachChild(visit);
  };
  visit(node);
  return ranges;
}

/**
 * The function body an anchor points at, or the reason it could not be resolved.
 *
 * The anchor need not be the function itself: `readonly htmlReadonlyView = computed(() => {`
 * anchors on a property whose initializer holds the arrow function. So the innermost nodes
 * containing the anchor are tried from the inside out, and the first function body found within
 * one of them wins. Working outwards is what makes a modifier keyword (`private`, `readonly`) a
 * usable starting point, since the anchor's offset lands on it.
 *
 * @param {string} filePath
 * @param {string} text
 * @param {string} anchor
 * @returns {{ body: string, error?: undefined } | { body?: undefined, error: string }}
 */
function bodyAtAnchor(filePath, text, anchor) {
  const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true);

  // Anchors are matched with comments blanked but literals intact: a test name lives in a string
  // literal and must still be anchorable, while a declaration quoted in a doc comment must not be.
  const searchable = blankOut(text, commentRanges(sourceFile, text));
  const at = searchable.indexOf(anchor);
  if (at === -1) return { error: 'no such code is in the file (comments are not searched)' };
  if (searchable.indexOf(anchor, at + anchor.length) !== -1) {
    return { error: 'it appears more than once, so the anchor is ambiguous' };
  }

  /** @type {ts.Node[]} */
  const containing = [];
  const collect = (node) => {
    if (node.getStart(sourceFile) <= at && at < node.getEnd()) {
      containing.push(node);
      node.forEachChild(collect);
    }
  };
  sourceFile.forEachChild(collect);

  const firstBody = (node) => {
    if (ts.isFunctionLike(node) && node.body) return node.body;
    let found = null;
    node.forEachChild((child) => {
      found ??= firstBody(child);
    });
    return found;
  };

  for (let i = containing.length - 1; i >= 0; i -= 1) {
    const body = firstBody(containing[i]);
    if (body) {
      const start = body.getStart(sourceFile);
      // Blank comments and literals so a guard can only be satisfied by executable code.
      const code = blankOut(text, [
        ...commentRanges(sourceFile, text),
        ...literalRanges(body, sourceFile),
      ]);
      return { body: code.slice(start, body.getEnd()) };
    }
  }
  return { error: 'it does not resolve to anything with a function body' };
}

let mitigationsChecked = 0;

for (const [name, entry] of Object.entries(allowlist.advisories ?? {})) {
  if (!Object.hasOwn(entry, 'mitigations')) continue;
  if (!Array.isArray(entry.mitigations) || entry.mitigations.length === 0) {
    fail(
      `the allowlist entry for ${name} supplies "mitigations" but it is not a non-empty array ` +
        `(got ${JSON.stringify(entry.mitigations)}). Remove the field or populate it.`,
    );
    continue;
  }
  for (const [i, m] of entry.mitigations.entries()) {
    const where = `${name} mitigations[${i}]`;
    const str = (v) => typeof v === 'string' && v.trim() !== '';
    if (!m || !str(m.file) || !str(m.declaration) || !str(m.claim)) {
      fail(`${where} needs non-empty "file", "declaration" and "claim" strings.`);
      continue;
    }
    const abs = resolve(repoRoot, m.file);
    if (!existsSync(abs)) {
      fail(
        `${where} points at ${m.file}, which does not exist. The file was moved or deleted, so ` +
          'the acceptance rests on code nobody can find — re-review it.',
      );
      continue;
    }
    const { body, error } = bodyAtAnchor(abs, readFileSync(abs, 'utf8'), m.declaration);
    if (error) {
      fail(
        `${where} anchors on "${m.declaration}" in ${m.file}, but ${error}. Do not just repair the ` +
          'pointer: a mitigation that was renamed or removed is a reason to re-review the acceptance.',
      );
      continue;
    }
    if (Object.hasOwn(m, 'guard')) {
      if (!str(m.guard)) {
        fail(`${where} supplies "guard" but it is not a non-empty string.`);
        continue;
      }
      if (!body.includes(m.guard)) {
        fail(
          `${where} credits "${m.guard}" inside "${m.declaration}" in ${m.file}, and it is no ` +
            'longer there as executable code — commenting it out counts as removing it. The ' +
            'mitigation this acceptance rests on is gone; the acceptance is void until it is ' +
            'restored or re-argued.',
        );
        continue;
      }
    }
    mitigationsChecked += 1;
  }
}

/* ------------------------------------------------------------------------ report ---- */

function relative(p) {
  return p.startsWith(repoRoot) ? p.slice(repoRoot.length + 1) : p;
}

if (asJson) {
  console.log(
    JSON.stringify(
      {
        ok: problems.length === 0,
        today,
        production: prodCounts,
        devInclusive: fullCounts,
        productionFindings: prodFindings,
        productionDependencies: prodDeps.length,
        unreferenced,
        mitigationsChecked,
        problems,
        notes,
      },
      null,
      2,
    ),
  );
  process.exit(problems.length ? 1 : 0);
}

console.log('\nSupply chain\n');
console.log(
  `  production audit    ${prodCounts.critical ?? 0} critical, ${prodCounts.high ?? 0} high, ` +
    `${prodCounts.moderate ?? 0} moderate, ${prodCounts.low ?? 0} low`,
);
console.log(
  `  dev-inclusive       ${fullCounts.critical ?? 0} critical, ${fullCounts.high ?? 0} high, ` +
    `${fullCounts.moderate ?? 0} moderate, ${fullCounts.low ?? 0} low   (reported, not gated)`,
);
console.log(
  `  production deps     ${prodDeps.length}, of which ${unreferenced.length} unreferenced`,
);
console.log(`  mitigations         ${mitigationsChecked} cited pointer(s) resolved in the source`);
console.log(`  date                ${today}`);
for (const n of notes) console.log(`\n  - ${n}`);

if (problems.length) {
  console.error(`\nsupply-chain: FAIL — ${problems.length} problem(s)\n`);
  for (const p of problems) console.error(`  - ${p}\n`);
  process.exit(1);
}
console.log(
  '\nsupply-chain: pass — nothing high or critical ships, and every acceptance is dated.',
);
