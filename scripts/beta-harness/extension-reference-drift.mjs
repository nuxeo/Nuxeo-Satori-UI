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

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
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

function sourceFiles() {
  const found = [];
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
 * The slot-state table.
 *
 * Rows read `| \`slot\` | description | state |`. The state column is prose, so it is
 * classified by the phrases the document itself defines in its "Read the three states
 * precisely" section rather than by a strict enum.
 */
function slotClaims() {
  const claims = [];
  for (const row of reference.matchAll(/^\|\s*`([a-zA-Z-]+)`\s*\|([^|]*)\|([^|]*)\|/gm)) {
    const [, slot, , stateText] = row;
    const state = /nothing resolves it/i.test(stateText)
      ? 'inert'
      : /resolves/i.test(stateText)
        ? 'resolves'
        : /populated/i.test(stateText)
          ? 'populated'
          : null;
    if (state) claims.push({ slot, state, stateText: stateText.trim() });
  }
  return claims;
}

const SLOT_CONST = (slot) =>
  /^[a-z][a-zA-Z]*$/.test(slot) ? `EXTENSION_SLOTS.${slot}` : `EXTENSION_SLOTS['${slot}']`;

for (const claim of slotClaims()) {
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
    `${registered.size} registered ID(s) all documented, and every slot-state claim holds.`,
);
