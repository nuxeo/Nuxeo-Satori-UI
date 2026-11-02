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
import { join, relative, resolve, sep } from 'node:path';

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
 * @param {string} anchor a literal line, or the first line that contains it
 * @returns {string[]} the rows after the header and its `---` separator
 */
function tableAfter(anchor) {
  const lines = reference.split('\n');
  const at = lines.findIndex((line) => line.includes(anchor));
  if (at === -1) {
    fail(
      `docs/extension-reference.md no longer contains \`${anchor}\`, so the table it anchors is ` +
        'unchecked. Restore the anchor, or delete the check that depends on it.',
    );
    return [];
  }
  let start = at + 1;
  while (start < lines.length && !lines[start].trimStart().startsWith('|')) start += 1;
  let end = start;
  while (end < lines.length && lines[end].trimStart().startsWith('|')) end += 1;
  // The header and its separator are not data.
  return lines.slice(start + 2, end);
}

/**
 * The slot-state table in section 2.
 *
 * Rows read `| \`slot\` | description | state |`. The state column is prose, so it is
 * classified by the phrases the document itself defines in its "Read the three states
 * precisely" section rather than by a strict enum.
 */
function slotClaims() {
  const claims = [];
  const rows = tableAfter('A slot is a named, ordered list of descriptors.');
  if (rows.length === 0)
    fail('The slot-state table in section 2 has no rows, so nothing is checked.');
  for (const row of rows.join('\n').matchAll(/^\|\s*`([a-zA-Z0-9.-]+)`\s*\|([^|]*)\|([^|]*)\|/gm)) {
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

const componentRows = tableAfter('satori:register:nxs-components').map((line) => {
  const cells = line
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim().replace(/^`|`$/g, ''));
  return { line, id: cells[0], element: cells[1], slot: cells[2] };
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
  if (!new RegExp(String.raw`selector:\s*'${reEscape(row.element)}'`).test(allSource)) {
    fail(
      `Section 6b gives \`${row.id}\` the element \`${row.element}\`, and no component outside ` +
        'specs declares that selector.',
    );
  }
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
    `${registered.size} registered ID(s) all documented, every slot-state claim holds, and ` +
    `${emptyTableNote}.`,
);
