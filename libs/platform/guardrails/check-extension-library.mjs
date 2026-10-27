#!/usr/bin/env node
/**
 * Guardrails for a **customer** Satori extension library.
 *
 * Ships inside `@nuxeo/satori-platform` so a customer can run it against their own
 * library in their own CI:
 *
 *   node node_modules/@nuxeo/satori-platform/guardrails/check-extension-library.mjs <dir>
 *
 * ## Why this is not our own guardrail script
 *
 * `scripts/review-guardrails.mjs` in the platform repository checks *our* invariants —
 * theme tokens, blob-URL lifecycles, adf-hx markers, evidence rules. None of that
 * applies to a customer, and it is a gate step in our own pipeline, so reshaping it to
 * serve two audiences would put a customer-facing concern on the critical path of our
 * build. This is a separate script with different checks and a different target.
 *
 * ## What it checks, and why each one exists
 *
 * Every check here corresponds to a mistake that has actually been made in this
 * codebase, not a hypothetical:
 *
 * 1. **Every registered ID carries the library's own owner prefix.** An ID is a public
 *    contract; borrowing the platform's `app.` prefix means a platform upgrade can
 *    collide with you.
 * 2. **No import reaches past a published entry point.** `@nuxeo/satori-platform/extensions`
 *    is supported; a deep path into its internals is not, and will break without being
 *    a breaking change.
 * 3. **A specs file asserts registry state.** A library whose tests never touch the
 *    registries can register nothing and stay green — three generators in this
 *    workspace did exactly that, spliced inside a comment, while lint, typecheck and
 *    six specs all passed.
 * 4. **Rules that gate a surface are declared fail-closed.** An unregistered rule ID
 *    evaluates to `true`; a gating rule that is missing therefore permits everything.
 * 5. **No component is exported from the barrel.** A host that can import the class
 *    depends on a name that should stay free to change.
 * 6. **Each registered component resolves, is named by a spec, uses the owner's selector
 *    prefix, and implements the contract of any `nxs.primitives.*` ID it overrides.** The
 *    registry swallows a failed load, so a wrong path is a blank slot with no error. A
 *    registration in a shape it does not read is a warning, and none of those checks runs on it.
 *
 * Exit code 0 = pass, 1 = at least one failure. Warnings do not fail.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';

const target = process.argv[2];
if (!target) {
  console.error(
    'Usage: node check-extension-library.mjs <library-directory>\n\n' +
      'e.g. node node_modules/@nuxeo/satori-platform/guardrails/check-extension-library.mjs libs/acme-extensions',
  );
  process.exit(2);
}

const ROOT = resolve(target);
if (!existsSync(ROOT)) {
  console.error(`No such directory: ${ROOT}`);
  process.exit(2);
}

const failures = [];
const warnings = [];
const fail = (m) => failures.push(m);
const warn = (m) => warnings.push(m);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

const files = walk(ROOT);
if (files.length === 0) {
  console.error(`No TypeScript files under ${ROOT}. Is that the right directory?`);
  process.exit(2);
}

/**
 * Comments removed before anything is matched.
 *
 * Every check below asks "does the code do X?" by searching text, so a comment saying X
 * answered yes. Check 3 was satisfied by `// TODO: assert against ExtensionActionRegistry
 * one day` in a spec file with every real registry assertion deleted — verified against
 * this script, not assumed. That is the same blind spot as the three generators that
 * spliced their registrations inside comments and reported success.
 *
 * Naive on purpose: a `//` inside a string truncates that line. It can only remove text,
 * so it can raise a false alarm — loud, investigable — and never manufacture a pass.
 */
const stripComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const read = (f) => stripComments(readFileSync(f, 'utf8'));
const sources = new Map(files.map((f) => [f, read(f)]));
const specs = [...sources].filter(([f]) => /\.(spec|test)\.ts$/.test(f));
const code = [...sources].filter(([f]) => !/\.(spec|test)\.ts$/.test(f));
const rel = (f) => f.slice(ROOT.length + 1);

// ---------------------------------------------------------------- 1. ID prefix ----

/**
 * The owner prefix, inferred from the IDs actually present.
 *
 * Inferred rather than required as an argument so the check cannot be silenced by
 * passing the wrong owner. The most common prefix wins; anything else is reported.
 * The platform's own prefixes never win: a library that only overrides `nxs.primitives.tag`
 * would otherwise be "owned" by `nxs`, and the selector check would demand `nxs-`.
 */
const PLATFORM_ID_PREFIXES = new Set(['app', 'nxs']);
const idPattern = /['"`]([a-z][a-z0-9]*)\.([a-zA-Z]+)\.([a-zA-Z][a-zA-Z0-9]*)['"`]/g;
const counts = new Map();
let platformIds = 0;
for (const [, text] of code) {
  for (const m of text.matchAll(idPattern)) {
    if (PLATFORM_ID_PREFIXES.has(m[1])) platformIds += 1;
    else counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  }
}
const owner = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];

if (!owner) {
  warn(
    platformIds
      ? 'Only platform IDs (`app.`, `nxs.`) found, so no owner prefix of your own was inferred. ' +
          'Overriding one is fine; anything you add needs your own `<owner>.` prefix.'
      : 'No `<owner>.<surface>.<name>` IDs found. Does this library register anything?',
  );
} else {
  for (const [file, text] of code) {
    for (const m of text.matchAll(idPattern)) {
      if (m[1] === owner) continue;
      // `app.` is the platform's own prefix. Referencing one to override it is
      // legitimate; *registering* under it is not. Distinguishing the two needs more
      // than a regex, so this is a warning with the reason stated.
      warn(
        `${rel(file)} uses the ID \`${m[0].slice(1, -1)}\`, whose prefix is not \`${owner}\`. ` +
          'Referencing a platform ID to override it is fine; registering under one is not — ' +
          'a platform upgrade can then collide with you.',
      );
    }
  }
}

// ------------------------------------------------------- 2. deep platform imports ----

const PUBLISHED = new Set([
  '@nuxeo/satori-platform',
  '@nuxeo/satori-platform/extensions',
  '@nuxeo/satori-platform/app-config',
  '@nuxeo/satori-platform/components',
  '@nuxeo/satori-platform/components-satori',
  '@nuxeo/satori-platform/nuxeo-client',
  '@nuxeo/satori-platform/ui',
]);

/**
 * `from '…'`, `import('…')` and `require('…')`.
 *
 * `from '…'`, `import('…')`, `require('…')` **and a bare `import '…'`**.
 *
 * The first cut matched only the static `from` form, so
 * `import('@nuxeo/satori-platform/extensions/internal/secret')` — a deep path into
 * internals, the exact thing this check exists to reject — passed. The second cut added the
 * call forms and still missed a **bare side-effect import**, which has neither `from` nor
 * parentheses; that was found when a probe against `upgrade-rehearsal.mjs`, which carried
 * the same regex, used precisely that form and was not caught.
 */
const SPECIFIER =
  /(?:from\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s*)['"](@nuxeo\/satori-platform[^'"]*)['"]/g;

for (const [file, text] of sources) {
  for (const m of text.matchAll(SPECIFIER)) {
    if (PUBLISHED.has(m[1])) continue;
    fail(
      `${rel(file)} imports \`${m[1]}\`, which is not a published entry point.\n` +
        `    Published: ${[...PUBLISHED].join(', ')}\n` +
        '    A deep path into internals will break without that being a breaking change.',
    );
  }
}

// ------------------------------------------------------ 3. specs assert registries ----

const REGISTRIES = [
  'ExtensionSlotRegistry',
  'ExtensionRuleRegistry',
  'ExtensionActionRegistry',
  'ExtensionComponentRegistry',
];

if (specs.length === 0) {
  fail(
    'This library has no spec files.\n' +
      '    A library that registers descriptors nothing renders is the failure the\n' +
      '    extension contract exists to prevent, and only a spec against the registries\n' +
      '    can tell the difference.',
  );
} else {
  const assertsRegistry = specs.some(([, text]) => REGISTRIES.some((r) => text.includes(r)));
  if (!assertsRegistry) {
    fail(
      `None of the ${specs.length} spec file(s) reference a registry.\n` +
        `    Assert observable state — e.g. \`ExtensionActionRegistry.has('${owner ?? 'acme'}.actions.x')\`.\n` +
        '    A spec that only checks your own function was called passes while nothing\n' +
        '    is registered.',
    );
  }

  // A rule asserted as `true` proves nothing: an unregistered ID evaluates to `true`.
  for (const [file, text] of specs) {
    if (/evaluate\([^)]*\)\s*\)\s*\.toBe\(true\)/s.test(text)) {
      warn(
        `${rel(file)} asserts a rule evaluates to \`true\`. An *unregistered* rule ID also ` +
          'evaluates to `true`, so that assertion passes whether or not registration ' +
          'happened. Assert `false` for at least one rule.',
      );
    }
  }
}

// ------------------------------------------------------------ 4. fail-closed rules ----

const registered = code.map(([, t]) => t).join('\n');
const gatingRules = [
  ...registered.matchAll(/['"`]([a-z][a-z0-9]*\.rules\.[a-zA-Z0-9]+)['"`]/g),
].map((m) => m[1]);
const uniqueRules = [...new Set(gatingRules)];
const failClosedBlock = /failClosedRules\s*:\s*\[([\s\S]*?)\]/.exec(registered);
const spreadsAll = /failClosedRules\s*:\s*\[\s*\.\.\./.test(registered);

if (uniqueRules.length > 0 && !failClosedBlock) {
  fail(
    `${uniqueRules.length} rule ID(s) are registered but \`failClosedRules\` is absent.\n` +
      '    An unregistered rule ID evaluates to `true`, so any rule that *gates* a\n' +
      '    surface permits everything while it is missing. Declare the gating ones.\n' +
      `    Rules found: ${uniqueRules.join(', ')}`,
  );
} else if (failClosedBlock && !spreadsAll) {
  const declared = failClosedBlock[1];
  const missing = uniqueRules.filter((id) => !declared.includes(id));
  if (missing.length) {
    warn(
      `${missing.length} rule(s) are not in \`failClosedRules\`: ${missing.join(', ')}.\n` +
        '    Correct if they only reveal an optional affordance; wrong if they gate a surface.',
    );
  }
}

// ------------------------------------------------------------- 5. barrel exports ----

const barrel = files.find((f) => basename(f) === 'index.ts');
if (!barrel) {
  warn('No index.ts found, so this library has no public surface to check.');
} else {
  const reportLeak = (name, via) =>
    fail(
      `index.ts exports \`${name}\`${via}.\n` +
        '    A component must not be exported: a host that can import the class depends\n' +
        '    on a name that should stay free to change. Hosts resolve it from the\n' +
        '    registry by ID, via ExtensionOutletComponent.',
    );

  const text = sources.get(barrel) ?? '';
  for (const m of text.matchAll(/export\s*(?:type\s*)?\{([^}]*)\}/g)) {
    for (const name of m[1].split(',')) {
      const clean = name
        .trim()
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/)
        .pop()
        ?.trim();
      if (clean?.endsWith('Component')) reportLeak(clean, '');
    }
  }

  /**
   * `export * from './lib/x'` re-exports every name in that module, components included,
   * and the braced-clause scan above cannot see any of them. Adding a two-line
   * `export * from './lib/leaky'` next to an `export class AcmeLeakyPanelComponent {}`
   * passed this check — verified against this script.
   *
   * Resolved one level deep, which is where a barrel's star exports point. Deeper chains
   * are not followed, and that limit is stated rather than hidden: this catches the shape
   * a customer actually writes, not every shape possible.
   */
  const barrelDir = ROOT;
  for (const m of text.matchAll(/export\s+\*(?:\s+as\s+\w+)?\s+from\s+['"](\.[^'"]*)['"]/g)) {
    const spec = m[1].replace(/^\.\//, '');
    const candidates = files.filter((f) => {
      const rest = f.slice(barrelDir.length + 1).replace(/\.ts$/, '');
      return rest.endsWith(spec) || rest.endsWith(`${spec}/index`);
    });
    if (candidates.length === 0) {
      warn(
        `index.ts has \`export * from '${m[1]}'\` which did not resolve to a file under ` +
          `${target}, so its exports were not checked for components.`,
      );
      continue;
    }
    for (const candidate of candidates) {
      for (const e of (sources.get(candidate) ?? '').matchAll(
        /export\s+(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g,
      )) {
        if (e[1].endsWith('Component')) {
          reportLeak(e[1], ` via \`export * from '${m[1]}'\``);
        }
      }
    }
  }
}

// ----------------------------------------------------- 6. component contributions ----

/**
 * Each component the library registers resolves, is named by a spec, carries the owner's selector
 * prefix, and — when it overrides one of the platform's `nxs.primitives.*` IDs — implements that
 * ID's input contract.
 *
 * - **Resolves.** `ExtensionComponentRegistry.resolve()` returns `null` for a loader that rejects,
 *   on purpose, so the outlet renders nothing and logs nothing. A wrong `import()` path or class
 *   name is a blank panel with no error anywhere; this is the only place it can be seen. The class
 *   must carry `@Component` imported from `@angular/core`: anything else resolves, then the outlet
 *   cannot create it.
 * - **Named by a spec.** Check 3 asks for one registry assertion in the library. A component no
 *   spec names — by its ID as a string, its key expression or its class, each whole, so
 *   `'acme.panel.claimsExtra'` does not name `acme.panel.claims` — is a registration nothing proves.
 * - **Selector prefix.** `nxs-` is the platform's component library and `lib-`/`app-`/`sat-` its
 *   shell and design system; a customer selector under one of them collides on an upgrade. Read
 *   from that class's own `@Component`, and applied to every selector in a comma-separated list
 *   and to each element, attribute and class name in it; a component with no selector has nothing
 *   to collide. A selector that is not a string literal is a warning.
 * - **Override contract.** A host renders `nxs.primitives.tag` with the inputs `NxsTagInputs`
 *   names, and the outlet silently drops an input the component does not declare — so an override
 *   that does not `implements` the interface renders with the wrong inputs, and nothing fails. The
 *   name in `implements` must be the platform's interface under whatever name the file imports it.
 *   **Known limit:** this reads the `implements` clause, and TypeScript is satisfied by a field
 *   that is not an Angular input — `declare readonly label: InputSignal<string>` — which the outlet
 *   then drops as well. Whether a member is a real `input()` or `@Input()` is only certain once
 *   Angular compiles it, which a text check does not do, and the library's typecheck passes it
 *   too, since the contract's members are typed `InputSignal<…>`. A spec that renders the override
 *   with the contract's inputs and asserts they arrive is what catches it; neither generator writes
 *   that spec for a customer override.
 *
 * Registrations are read from each `components: { … }` object literal, the key quoted or not, in
 * the two shapes the contract uses: `'id': () => import('./x').then((m) => m.X)` and `'id': X` with
 * `X` imported by name, aliased or not, from a relative path. A registration in neither shape is a
 * warning, so it is seen, not skipped — but none of these checks runs on it; so is a `components`
 * given a constant rather than an object literal, and a spread inside one.
 *
 * Every such object, not only the one written inside `provideSatoriExtensions(…)`: contributions
 * are as often a typed `SatoriExtensionContributions` constant declared in a file of their own,
 * and a scan scoped to the call would skip those without a word. The cost is that an unrelated
 * `components` object with quoted keys is read as registrations, loudly; one with plain keys, the
 * usual way to write it, is not read at all.
 */
// One entry per `NXS_PRIMITIVE_IDS` member, which this file cannot read in a customer's CI;
// `scripts/check-extension-library.selftest.mjs` fails when the two lists differ.
const PRIMITIVE_CONTRACTS = {
  avatar: 'NxsAvatarInputs',
  breadcrumbs: 'NxsBreadcrumbsInputs',
  tag: 'NxsTagInputs',
  statusTag: 'NxsStatusTagInputs',
  richTooltip: 'NxsRichTooltipInputs',
  errorState: 'NxsErrorStateInputs',
  tabs: 'NxsTabsInputs',
  actionBar: 'NxsActionBarInputs',
  card: 'NxsCardInputs',
  emptyState: 'NxsEmptyStateInputs',
};

const COMPONENTS_KEY = String.raw`(?:\bcomponents|'components'|"components")\s*:\s*`;

/** The body of every `components: { … }` object literal in `text`, braces matched. */
function componentObjects(text) {
  const bodies = [];
  for (const match of text.matchAll(new RegExp(String.raw`${COMPONENTS_KEY}\{`, 'g'))) {
    let depth = 1;
    let at = match.index + match[0].length;
    const start = at;
    while (at < text.length && depth > 0) {
      if (text[at] === '{') depth += 1;
      else if (text[at] === '}') depth -= 1;
      at += 1;
    }
    bodies.push(text.slice(start, at - 1));
  }
  return bodies;
}

/** The `.ts` file a relative specifier names, or `null`. */
function resolveRelative(fromFile, specifier) {
  const base = resolve(fromFile, '..', specifier);
  // `./x.js` names `./x.ts` under ESM resolution.
  for (const candidate of [
    `${base}.ts`,
    join(base, 'index.ts'),
    base,
    base.replace(/\.js$/, '.ts'),
  ]) {
    if (sources.has(candidate)) return candidate;
  }
  return null;
}

/**
 * The class `name`, as `file` exports it: `{ file, name }` where it is declared, or `null`.
 *
 * Follows what a barrel does to a class on its way out — `export { X } from`, `export { Y as X }
 * from`, `export * from` and a local `export { Y as X }` — so a registration through an `index.ts`
 * is checked against the class itself, and its selector and contract are read from the file that
 * declares it. A type-only export is not a value, so it is not followed. Bounded, so a cycle ends.
 */
function declaration(file, name, depth = 0) {
  const text = sources.get(file);
  if (text === undefined || depth > 8) return null;
  if (new RegExp(String.raw`export\s+class\s+${name}\b`).test(text)) {
    return { file, name };
  }
  for (const m of text.matchAll(/export\s*\{([^}]*)\}(?:\s*from\s*['"]([^'"]+)['"])?/g)) {
    const binding = bindings(m[1]).find(({ local, typeOnly }) => !typeOnly && local === name);
    if (!binding) continue;
    if (!m[2]) {
      const local = new RegExp(String.raw`\bclass\s+${binding.imported}\b`).test(text);
      return local ? { file, name: binding.imported } : null;
    }
    const next = m[2].startsWith('.') ? resolveRelative(file, m[2]) : null;
    return next && declaration(next, binding.imported, depth + 1);
  }
  for (const m of text.matchAll(/export\s+\*\s+from\s+['"](\.[^'"]*)['"]/g)) {
    const next = resolveRelative(file, m[1]);
    const found = next && declaration(next, name, depth + 1);
    if (found) return found;
  }
  return null;
}

/** `A, B as C, type D` → `{ imported, local, typeOnly }` per name: `B` is imported, `C` local. */
function bindings(clause) {
  return clause
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const typeOnly = /^type\s/.test(part);
      const [imported, local = imported] = part
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/)
        .map((s) => s.trim());
      return { imported, local, typeOnly };
    });
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * `token` in `text` as a whole expression — not `AcmeClaimsComponentFake` for `AcmeClaimsComponent`,
 * nor `OTHER.IDS.x` for `IDS.x`. A class name may follow a `.`: `m.AcmeClaimsComponent` is the class.
 */
const namesToken = (text, token, { member = false } = {}) =>
  new RegExp(String.raw`(?<![\w$${member ? '' : '.'}])${escapeRegExp(token)}(?![\w$])`).test(text);

/** `id` as a whole string literal — not `'acme.panel.claimsExtra'` for `acme.panel.claims`. */
const namesString = (text, id) =>
  new RegExp(String.raw`(['"\x60])${escapeRegExp(id)}\1`).test(text);

/**
 * The argument text of the decorator, under one of `names`, on class `name` in `text`, or `null`.
 *
 * The decorator on that class, not the first `selector:` anywhere in the file: a file can declare
 * several classes, and a class with no `@Component` is not a component at all. Only whitespace and
 * other argument-less or flat decorators may sit between the two.
 */
function componentDecorator(text, name, names) {
  if (names.length === 0) return null;
  const declared = new RegExp(String.raw`(?:export\s+)?class\s+${name}\b`).exec(text);
  if (!declared) return null;
  const before = text.slice(0, declared.index);
  const decorator = new RegExp(String.raw`@(?:${names.map(escapeRegExp).join('|')})\s*\(`, 'g');
  let args = null;
  for (const m of before.matchAll(decorator)) {
    let depth = 1;
    let at = m.index + m[0].length;
    while (at < before.length && depth > 0) {
      if (before[at] === '(') depth += 1;
      else if (before[at] === ')') depth -= 1;
      at += 1;
    }
    if (depth === 0 && /^\s*(?:@[\w.]+(?:\([^()]*\))?\s*)*$/.test(before.slice(at))) {
      args = before.slice(m.index + m[0].length, at - 1);
    }
  }
  return args;
}

/**
 * Each `import …{ … } from '…'` in `text`, a default import beside the braces included, and whether
 * the whole statement is `import type`.
 */
function* namedImports(text) {
  for (const m of text.matchAll(
    /import\s*(type\s+)?(?:[\w$]+\s*,\s*)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g,
  )) {
    yield { clause: m[2], from: m[3], typeOnly: Boolean(m[1]) };
  }
}

/**
 * The names `text` can use for `name` exported by a module `isFrom` accepts: each local binding,
 * aliased or not, and `ns.name` for a namespace import. With `values`, a type-only import is left
 * out: TypeScript erases it, so it names nothing at run time.
 */
function localNames(text, name, isFrom, { values = false } = {}) {
  const locals = [];
  for (const { clause, from, typeOnly } of namedImports(text)) {
    if (!isFrom(from) || (values && typeOnly)) continue;
    for (const b of bindings(clause)) {
      if (b.imported === name && !(values && b.typeOnly)) locals.push(b.local);
    }
  }
  for (const m of text.matchAll(
    /import\s*(type\s+)?\*\s*as\s+([\w$]+)\s*from\s*['"]([^'"]+)['"]/g,
  )) {
    if (isFrom(m[3]) && !(values && m[1])) locals.push(`${m[2]}.${name}`);
  }
  return locals;
}

const RESERVED_PREFIXES = ['nxs', 'lib', 'app', 'sat'];

/**
 * The element, attribute and class names one selector matches on, `:not(…)` left out because
 * it excludes rather than claims: `button[acme-button]` is `button` and `acme-button`.
 */
function selectorNames(selector) {
  const bare = selector.replace(/:not\([^)]*\)/g, '');
  const element = /^[a-zA-Z][\w-]*/.exec(bare)?.[0];
  return [
    ...(element ? [{ kind: 'element', name: element }] : []),
    ...[...bare.matchAll(/\[\s*([^\]\s=~|^$*]+)/g)].map((m) => ({ kind: 'attribute', name: m[1] })),
    ...[...bare.replace(/\[[^\]]*\]/g, '').matchAll(/\.([\w-]+)/g)].map((m) => ({
      kind: 'class',
      name: m[1],
    })),
  ];
}

/** `nxs-claims`, `[nxs-claims]`, `[nxsClaims]` — not `[appearance]`, whose letters only begin so. */
const isReserved = ({ kind, name }, prefix) =>
  name.startsWith(`${prefix}-`) ||
  (kind !== 'element' && (name === prefix || new RegExp(String.raw`^${prefix}[A-Z]`).test(name)));

/** An element under `<owner>-`; an attribute or class beginning with the owner, as `[acmeClaims]`. */
const isOwners = ({ kind, name }, owner) =>
  kind === 'element' ? name.startsWith(`${owner}-`) : name.startsWith(owner);

/** The package or one of its entry points — not `@nuxeo/satori-platform-extras`. */
const isPlatform = (specifier) => /^@nuxeo\/satori-platform(?:\/|$)/.test(specifier);
const isComponentsEntry = (specifier) => specifier === '@nuxeo/satori-platform/components';
const isAngularCore = (specifier) => specifier === '@angular/core';

const KEY = String.raw`(\[(?:[^\[\]]|\[[^\]]*\])+\]|['"\x60][^'"\x60]+['"\x60])`;
const LAZY = new RegExp(
  // `,?` before each `)`: Prettier adds a trailing comma when it breaks the call across lines.
  String.raw`${KEY}\s*:\s*\(\s*\)\s*=>\s*import\(\s*['"]([^'"]+)['"]\s*,?\s*\)\s*\.then\(\s*\(?\s*(\w+)\s*\)?\s*=>\s*\3\.(\w+)\s*,?\s*\)`,
  'g',
);
const EAGER = new RegExp(String.raw`${KEY}\s*:\s*([A-Z][\w$]*)\s*(?=,|$)`, 'g');
const ANY_ENTRY = new RegExp(String.raw`${KEY}\s*:`, 'g');

const contributions = [];
for (const [file, text] of code) {
  // A value, not a type: `components: SomeType` in an interface is PascalCase and not warned
  // about, nor is a keyword or a primitive type.
  const notValue = String.raw`(?![A-Z][a-z])(?!(?:true|false|null|undefined|string|number|boolean|any|unknown|never|object)\b)`;
  for (const m of text.matchAll(
    new RegExp(String.raw`${COMPONENTS_KEY}${notValue}([A-Za-z_$][\w$.]*)\s*[,}\n]`, 'g'),
  )) {
    warn(
      `${rel(file)} passes \`components: ${m[1]}\`, not an object literal, so none of the ` +
        'component checks ran on its entries. Write them in the `components: { … }` object itself.',
    );
  }
  for (const body of componentObjects(text)) {
    for (const m of body.matchAll(/\.\.\.\s*([\w$.]+)/g)) {
      warn(
        `${rel(file)} spreads \`${m[1]}\` into its components, so none of the component checks ran ` +
          'on what it contains. Write those entries in the object itself.',
      );
    }
    const seenKeys = new Set();
    for (const m of body.matchAll(LAZY)) {
      seenKeys.add(m[1]);
      contributions.push({
        file,
        key: m[1],
        className: m[4],
        exported: m[4],
        target: resolveRelative(file, m[2]),
        from: m[2],
      });
    }
    for (const m of body.matchAll(EAGER)) {
      if (seenKeys.has(m[1])) continue;
      let binding;
      let from;
      for (const imported of namedImports(text)) {
        binding = bindings(imported.clause).find(
          ({ local, typeOnly }) => !typeOnly && local === m[2],
        );
        from = imported.from;
        if (binding) break;
      }
      // Only a named import is read. A default or namespace import, a class declared in this file
      // or one from another package stays unseen, so the warning below names it.
      if (!binding) continue;
      if (isPlatform(from)) {
        seenKeys.add(m[1]); // a platform class, re-registered
        continue;
      }
      if (!from.startsWith('.')) continue;
      seenKeys.add(m[1]);
      contributions.push({
        file,
        key: m[1],
        className: m[2],
        exported: binding.imported,
        target: resolveRelative(file, from),
        from,
      });
    }
    for (const m of body.matchAll(ANY_ENTRY)) {
      if (!seenKeys.has(m[1])) {
        warn(
          `${rel(file)} registers the component ${m[1]} in a shape this check does not read, so ` +
            'none of the component checks ran on it. Use `() => import(...).then((m) => m.X)` or an imported class.',
        );
      }
    }
  }
}

const specText = specs.map(([, text]) => text).join('\n');
for (const { file, key, className, exported, target, from } of contributions) {
  const where = `${rel(file)} registers ${key}`;
  if (!target) {
    fail(
      `${where} from '${from}', which is not a file in this library. The registry swallows the ` +
        'failed import, so the slot renders nothing and nothing reports it.',
    );
    continue;
  }
  const declared = declaration(target, exported);
  if (!declared) {
    fail(
      `${where} as \`${exported}\`, which ${rel(target)} does not export. The registry swallows ` +
        'the failed load, so the slot renders nothing and nothing reports it.',
    );
    continue;
  }
  const componentSource = sources.get(declared.file);
  // Only Angular's `Component`, under whatever name the file imports it by value: a `Component`
  // from another package, or one no import binds, leaves no component definition for the outlet.
  const decorator = componentDecorator(
    componentSource,
    declared.name,
    localNames(componentSource, 'Component', isAngularCore, { values: true }),
  );
  if (decorator === null) {
    const lookalike = componentDecorator(componentSource, declared.name, [
      'Component',
      ...localNames(componentSource, 'Component', () => true),
    ]);
    fail(
      lookalike === null
        ? `${where} as \`${declared.name}\`, which ${rel(declared.file)} declares without ` +
            '`@Component`. It resolves, then the outlet cannot create it, so the slot renders nothing.'
        : `${where} as \`${declared.name}\`, which ${rel(declared.file)} decorates with a ` +
            "`@Component` not imported from '@angular/core'. Angular compiles no component from " +
            'it, so the outlet cannot create it and the slot renders nothing.',
    );
    continue;
  }
  // `['acme.x']` and `[\`acme.x\`]` are the ID itself, as `'acme.x'` is.
  const literal = /^\[\s*(['"\x60])([^'"\x60]+)\1\s*\]$/.exec(key);
  const keyText = literal ? literal[2] : key.replace(/^['"\x60]|['"\x60]$/g, '');
  const quoted = Boolean(literal) || keyText !== key;
  const named =
    (quoted
      ? namesString(specText, keyText)
      : namesToken(specText, key.replace(/^\[\s*|\s*\]$/g, ''))) ||
    [className, declared.name].some((name) => namesToken(specText, name, { member: true }));
  if (!named) {
    fail(
      `${where} (\`${className}\`), and no spec names it — not its ID, its key, nor its class. ` +
        'Render it, or assert `ExtensionComponentRegistry.has(...)` for it.',
    );
  }
  // A component with no selector is still renderable by the outlet; only a declared one can collide.
  const selectors = /\bselector\s*:\s*(['"\x60])([^'"\x60]+)\1/.exec(decorator)?.[2];
  if (selectors === undefined && /\bselector\s*:/.test(decorator)) {
    warn(
      `${rel(declared.file)}: \`${declared.name}\`'s selector is not a string literal, so its ` +
        'prefix was not checked.',
    );
  }
  for (const selector of (selectors ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    const names = selectorNames(selector);
    const reserved = names.some((n) => RESERVED_PREFIXES.some((prefix) => isReserved(n, prefix)));
    const owners = !owner || names.some((n) => isOwners(n, owner));
    if (!reserved && owners) continue;
    fail(
      `${rel(declared.file)} declares selector \`${selector}\`. Use your owner prefix` +
        `${owner ? `, \`${owner}-\`` : ''}: ` +
        '`nxs-` is the platform component library and `lib-`, `app-` and `sat-` its shell and ' +
        'design system, so a selector under them collides on an upgrade.',
    );
  }
  // Anchored, and the whole suffix kept: `nxs.primitives.tag.extra` is not the `tag` primitive.
  // `NXS_PRIMITIVE_IDS.tag` under any name the registering file imports it by.
  const primitiveIds = [
    'NXS_PRIMITIVE_IDS',
    ...localNames(sources.get(file), 'NXS_PRIMITIVE_IDS', isPlatform),
  ];
  const primitive =
    /^nxs\.primitives\.(.+)$/.exec(keyText)?.[1] ??
    new RegExp(
      String.raw`^\[\s*(?:${primitiveIds.map(escapeRegExp).join('|')})\s*(?:\.\s*(\w+)|\[\s*['"\x60](\w+)['"\x60]\s*\])\s*\]$`,
    )
      .exec(key)
      ?.slice(1)
      .find(Boolean);
  const contract = primitive && PRIMITIVE_CONTRACTS[primitive];
  // The name the class implements must be the one bound to the platform's interface: aliased or
  // not, and not a same-named one declared locally or taken from elsewhere.
  const implemented = (
    new RegExp(String.raw`class\s+${declared.name}\b[^{]*?\bimplements\b([^{]*)\{`).exec(
      componentSource,
    )?.[1] ?? ''
  )
    .split(',')
    .map((name) => name.replace(/<[\s\S]*$/, '').trim());
  const implementsContract =
    contract &&
    localNames(componentSource, contract, isComponentsEntry).some((local) =>
      implemented.includes(local),
    );
  if (primitive && !contract) {
    fail(`${where}, but the platform has no \`nxs.primitives.${primitive}\` to override.`);
  } else if (contract && !implementsContract) {
    fail(
      `${where}, overriding a platform primitive, but \`${declared.name}\` does not implement ` +
        `\`${contract}\` from '@nuxeo/satori-platform/components'. A host passes that interface's ` +
        'inputs and the outlet drops any the component does not declare, so it would render with ' +
        'the wrong inputs and nothing would fail.',
    );
  }
}

// ------------------------------------------------------------------- report ----

for (const w of warnings) console.warn(`[warn] ${w}`);

if (failures.length) {
  console.error(`\ncheck-extension-library: FAIL — ${failures.length} problem(s) in ${target}\n`);
  for (const f of failures) console.error(`- ${f}\n`);
  process.exit(1);
}

console.log(
  `check-extension-library: pass — ${target}` +
    `${owner ? ` (owner \`${owner}\`)` : ''}, ${code.length} source file(s), ` +
    `${specs.length} spec file(s), ${contributions.length} component registration(s)` +
    `${warnings.length ? `, ${warnings.length} warning(s)` : ''}.`,
);
