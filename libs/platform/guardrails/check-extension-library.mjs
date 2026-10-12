#!/usr/bin/env node
/**
 * Guardrails for a **customer** Satori extension library.
 *
 * Ships inside `@nuxeo-satori/platform` so a customer can run it against their own
 * library in their own CI:
 *
 *   node node_modules/@nuxeo-satori/platform/guardrails/check-extension-library.mjs <dir>
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
 * 2. **No import reaches past a published entry point.** `@nuxeo-satori/platform/extensions`
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
 *
 * Exit code 0 = pass, 1 = at least one failure. Warnings do not fail.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';

const target = process.argv[2];
if (!target) {
  console.error(
    'Usage: node check-extension-library.mjs <library-directory>\n\n' +
      'e.g. node node_modules/@nuxeo-satori/platform/guardrails/check-extension-library.mjs libs/acme-extensions',
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
 */
const idPattern = /['"`]([a-z][a-z0-9]*)\.([a-zA-Z]+)\.([a-zA-Z][a-zA-Z0-9]*)['"`]/g;
const counts = new Map();
for (const [, text] of code) {
  for (const m of text.matchAll(idPattern)) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
}
const owner = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];

if (!owner) {
  warn('No `<owner>.<surface>.<name>` IDs found. Does this library register anything?');
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
  '@nuxeo-satori/platform',
  '@nuxeo-satori/platform/extensions',
  '@nuxeo-satori/platform/app-config',
  '@nuxeo-satori/platform/components',
  '@nuxeo-satori/platform/components-satori',
  '@nuxeo-satori/platform/nuxeo-client',
  '@nuxeo-satori/platform/ui',
]);

/**
 * `from '…'`, `import('…')` and `require('…')`.
 *
 * `from '…'`, `import('…')`, `require('…')` **and a bare `import '…'`**.
 *
 * The first cut matched only the static `from` form, so
 * `import('@nuxeo-satori/platform/extensions/internal/secret')` — a deep path into
 * internals, the exact thing this check exists to reject — passed. The second cut added the
 * call forms and still missed a **bare side-effect import**, which has neither `from` nor
 * parentheses; that was found when a probe against `upgrade-rehearsal.mjs`, which carried
 * the same regex, used precisely that form and was not caught.
 */
const SPECIFIER =
  /(?:from\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s*)['"](@nuxeo-satori\/platform[^'"]*)['"]/g;

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
    `${specs.length} spec file(s)` +
    `${warnings.length ? `, ${warnings.length} warning(s)` : ''}.`,
);
