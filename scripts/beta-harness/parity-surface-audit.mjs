#!/usr/bin/env node
/**
 * Static audit of the parity steps' surface adapters.
 *
 * `scripts/beta-harness/steps/nxsat-308-parity.mjs` captures the same claims twice, once on the
 * upstream adf-hx components and once on their nxs- replacements. The upstream half cannot be
 * captured again — NXSAT-637 removed the packages — so the file's rule is that the steps and the
 * expected values are written once and only the surface adapter changes between the halves.
 *
 * That rule only holds if the adapter can express everything that differs, and if a difference
 * cannot take the run down. Both failed, and the parity run was unable to finish for two months:
 *
 *   - A breadcrumb crumb was selected by its label. The label was one of the things under test, so
 *     the one real defect there — a trail labelled with path segments rather than document titles
 *     — turned into a 30 s `locator.click` timeout, `verdict: error`, and eleven of the
 *     twenty-four steps never ran at all. The same thing happened again at 320 px, where the nav
 *     drawer covers the tab the step clicks.
 *   - The fallback element, the properties labels, the search page size, how a search is
 *     submitted, the no-results wording and how a permission option is chosen were written into
 *     the step bodies as one surface's answer. Each read as a parity failure on a surface that
 *     behaved correctly. One was worse than a false red: a permission option matched by its
 *     translated label ("Manage everything", not "Everything") staged no change, so the save under
 *     test never ran — and the check that `AddChildren` survived it passed on an untouched ACL.
 *
 * Three rules, each one of those failures made mechanical:
 *
 *   `unguarded-click`         a `.click()` with no `.catch()`. One blocked click ends the run, and
 *                             the check after it would have reported what was on screen.
 *   `surface-selector-in-step` a selector naming a surface's own element (`nxs-`, `hxp-`, `adf-`,
 *                             `sat-`, `lib-`) passed to `locator`, `$$eval`, `$eval` or
 *                             `waitForSelector` from outside a surface adapter.
 *   `adapter-gap`             a surface that does not define an adapter key the steps read, so
 *                             that surface reads `undefined` where another reads a selector. Both
 *                             `A.group.member` and a key read directly, like `A.crumbHref`.
 *
 * What this CANNOT do, stated narrowly because the useful version of this tool is the one whose
 * reach is not overstated:
 *
 *   - It does not find a surface-specific *class* with no prefix. `.result-list`, `.row-name-text`
 *     and `.viewer-placeholder` are as surface-bound as `nxs-document-list`, and nothing here can
 *     tell them from a shared one. Only the element-prefix form is decided.
 *   - It does not judge whether an adapter's selector is *correct*. `nxs-breadcrumbs` was a real
 *     element of this repository and still matched nothing on the app, because `app.config.ts`
 *     re-registers that primitive on Satori. A selector is checked for existing, not for matching.
 *   - It reads one file's adapters. A steps file that builds a selector at run time, or reaches
 *     the DOM through a helper it was handed, is outside all three rules.
 *
 * Usage:
 *   node scripts/beta-harness/parity-surface-audit.mjs [--json] [file...]
 *
 * Exit 1 if any rule is broken. Exit 2 if the file cannot be read, parsed, or resolved — an
 * unresolvable `SURFACES` entry refuses the whole map rather than auditing the rest, because a
 * surface skipped quietly is a surface the run reports a pass without having looked at. An adapter
 * spread that cannot be followed is refused the same way, because the keys it may overwrite would
 * otherwise be certified as inherited.
 */

import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..', '..');
const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const explicit = argv.filter((a) => !a.startsWith('--'));

const DEFAULT_FILES = ['scripts/beta-harness/steps/nxsat-308-parity.mjs'];

export const DECLARED_LIMITS = [
  'a surface-specific CSS class with no element prefix (.result-list, .viewer-placeholder)',
  'whether an adapter selector matches anything on the running app',
  'a selector built at run time, or reached through a helper the steps were handed',
  'a click guarded by a try/catch rather than by .catch() — only the .catch() form is recognised',
];

/**
 * The element prefixes this repository's own components and the upstream packages use.
 *
 * `(` is a boundary as much as a space or a comma is: `:is(nxs-error-state) button` and
 * `main:has(nxs-error-state)` name a surface's component just as directly as `nxs-error-state`
 * does, and without it they passed the rule — not as a runtime-built selector, which is a declared
 * limit, but as a literal the matcher simply did not reach into.
 */
const SURFACE_ELEMENT = /(?:^|[\s,>~+(])(?:nxs|hxp|adf|sat|lib)-[a-z][a-z0-9-]*/;

/**
 * Calls whose first argument is a CSS selector, in the runner and inside a `page.evaluate` alike:
 * the fallback element and the properties labels were both inlined as a `querySelectorAll` in a
 * browser function, where no amount of reading the adapter would have shown them.
 * `route`/`unroute` take URL globs, so not those.
 */
const SELECTOR_CALLS = new Set([
  'locator',
  '$$eval',
  '$eval',
  'waitForSelector',
  'querySelector',
  'querySelectorAll',
]);

let parse;
try {
  ({ parse } = await import('acorn'));
} catch {
  console.error(
    'parity-surface-audit: acorn is unavailable, so the steps cannot be parsed.\n' +
      'It ships with the toolchain; run `npm ci` and try again. Refusing to pass by default.',
  );
  process.exit(2);
}

/** Depth-first walk that hands every node its parent chain, innermost first. */
function walk(node, visit, parents = []) {
  if (!node || typeof node.type !== 'string') return;
  visit(node, parents);
  const next = [node, ...parents];
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc') continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) walk(child, visit, next);
    } else if (value && typeof value === 'object' && typeof value.type === 'string') {
      walk(value, visit, next);
    }
  }
}

const propertyName = (prop) =>
  prop.key?.type === 'Identifier'
    ? prop.key.name
    : prop.key?.type === 'Literal'
      ? String(prop.key.value)
      : null;

/** Every top-level `const NAME = { … }`, by name. */
function topLevelObjects(ast) {
  const objects = new Map();
  for (const node of ast.body) {
    if (node.type !== 'VariableDeclaration') continue;
    for (const decl of node.declarations) {
      if (decl.id.type === 'Identifier' && decl.init?.type === 'ObjectExpression') {
        objects.set(decl.id.name, decl.init);
      }
    }
  }
  return objects;
}

/**
 * The adapters, from the `SURFACES` map rather than from a hardcoded list of names: the map is
 * what the steps dispatch on, so a surface added without being registered there is not a surface.
 *
 * An entry this cannot resolve **refuses the whole map** rather than auditing the rest. Skipping
 * one quietly was the audit's own version of the bug it exists to catch: with
 * `nxs: { ...NXS, search: {} }` written inline, or a misspelled `nxs: NXS_TYPO`, the `nxs` surface
 * was dropped and the run passed having never looked at it. Only `id: NAME`, where `NAME` is a
 * top-level `const NAME = { … }`, is supported; an inline object or a spread in the map is a shape
 * this cannot follow, and saying so is the only safe answer.
 *
 * @returns {{surfaces: Map<string, {name: string, object: object}>} | {problem: string}}
 */
function findSurfaces(ast, objects) {
  const map = objects.get('SURFACES');
  if (!map) {
    return {
      problem: 'no SURFACES map of named adapter objects was found, so there is nothing to audit',
    };
  }
  const surfaces = new Map();
  const mustBeNamed =
    'Every entry must be `id: NAME`, where NAME is a top-level `const NAME = { … }` — otherwise a ' +
    'surface would be skipped and the run would pass without ever checking it';
  for (const prop of map.properties) {
    if (prop.type !== 'Property') {
      return { problem: `SURFACES holds a ${prop.type} this audit cannot resolve. ${mustBeNamed}` };
    }
    const id = propertyName(prop);
    if (prop.computed || !id || prop.value.type !== 'Identifier') {
      return {
        problem: `SURFACES entry ${JSON.stringify(id ?? '(computed)')} is not \`id: NAME\`. ${mustBeNamed}`,
      };
    }
    const object = objects.get(prop.value.name);
    if (!object) {
      return {
        problem:
          `SURFACES entry ${JSON.stringify(id)} names ${prop.value.name}, which is not a ` +
          `top-level \`const … = { … }\` in this file. ${mustBeNamed}`,
      };
    }
    surfaces.set(id, { name: prop.value.name, object });
  }
  if (surfaces.size === 0) return { problem: 'SURFACES is empty, so there is nothing to audit' };
  return { surfaces };
}

/** An adapter spread this audit cannot follow; the caller refuses the file with exit 2. */
class UnresolvedSpread extends Error {}

/**
 * An adapter's keys, following `...OTHER` spreads so a derived surface inherits what it reuses.
 * A group whose value is not an object literal — `knownGaps: new Set(…)` — is recorded with no
 * members: it is a value, not a group of selectors, and `A.knownGaps.has(…)` is a method call on
 * it rather than an adapter key that could be missing.
 *
 * A spread that cannot be resolved throws `UnresolvedSpread` rather than being skipped. Skipping
 * it kept whatever earlier spreads supplied, so `{ ...ADF_HX, ...CONFIG.nxs }` with
 * `CONFIG.nxs = { search: {} }` was audited as still holding `search.pageSize`, which is
 * undefined at run time. An alias, an `Object.freeze(…)` initializer, a member expression, a
 * call, or a cycle are all shapes this cannot follow, and the only safe answer is to say so.
 */
function adapterKeys(object, objects, seen = new Set()) {
  const keys = new Map();
  for (const prop of object.properties) {
    if (prop.type === 'SpreadElement') {
      // A spread of an object literal, `{ ...ADF_HX, ...{ search: {} } }`, was skipped outright,
      // so the audit read `search.pageSize` as still inherited where JavaScript had replaced the
      // whole group and `A.search.pageSize` is undefined. Both spread forms are resolved, in
      // source order, so a later group replaces an inherited one here exactly as it does at run
      // time. Only a named spread needs the cycle guard; an inline object cannot refer to itself.
      let inline;
      if (prop.argument.type === 'ObjectExpression') {
        inline = adapterKeys(prop.argument, objects, seen);
      } else if (prop.argument.type === 'Identifier') {
        const name = prop.argument.name;
        if (seen.has(name)) {
          throw new UnresolvedSpread(`the spread ...${name} refers back to itself`);
        }
        const source = objects.get(name);
        if (!source) {
          throw new UnresolvedSpread(
            `the spread ...${name} does not name a top-level \`const ${name} = { … }\` in this file`,
          );
        }
        inline = adapterKeys(source, objects, new Set([...seen, name]));
      } else {
        throw new UnresolvedSpread(
          `a spread of a ${prop.argument.type} cannot be resolved; only \`...NAME\` of a ` +
            'top-level `const NAME = { … }` or an inline object literal can be',
        );
      }
      for (const [group, members] of inline) keys.set(group, members);
      continue;
    }
    if (prop.computed && prop.key?.type !== 'Literal') {
      throw new UnresolvedSpread(
        'a computed adapter property cannot be resolved statically',
      );
    }
    const name = propertyName(prop);
    if (!name) continue;
    // A group defined here replaces an inherited one outright, exactly as the spread does.
    if (prop.value.type === 'ObjectExpression') {
      // Check for computed keys inside group members before collecting them
      for (const member of prop.value.properties) {
        if (member.computed && member.key?.type !== 'Literal') {
          throw new UnresolvedSpread(
            `computed key inside adapter group ${JSON.stringify(name)} cannot be resolved statically`,
          );
        }
      }
      keys.set(name, new Set(prop.value.properties.map(propertyName).filter(Boolean)));
    } else {
      keys.set(name, null);
    }
  }
  return keys;
}

/** Whether this call expression's result has `.catch(…)` called on it. */
function isCaught(call, parents) {
  const [parent, grandparent] = parents;
  return Boolean(
    parent?.type === 'MemberExpression' &&
    parent.object === call &&
    parent.property?.type === 'Identifier' &&
    parent.property.name === 'catch' &&
    grandparent?.type === 'CallExpression' &&
    grandparent.callee === parent,
  );
}

async function auditFile(file) {
  const abs = resolve(repoRoot, file);
  const rel = relative(repoRoot, abs);
  let source;
  try {
    source = await readFile(abs, 'utf8');
  } catch (error) {
    return { file: rel, unreadable: String(error.message), findings: [] };
  }
  let ast;
  try {
    ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  } catch (error) {
    return { file: rel, unparsable: String(error.message), findings: [] };
  }

  const objects = topLevelObjects(ast);
  const resolved = findSurfaces(ast, objects);
  if ('problem' in resolved) {
    return { file: rel, unparsable: resolved.problem, findings: [] };
  }
  const { surfaces } = resolved;

  const adapterObjects = [...new Set([...surfaces.values()].map((s) => s.object))];
  const objectRanges = adapterObjects.map((o) => [o.start, o.end]);
  const within = (ranges, node) =>
    ranges.some(([start, end]) => node.start >= start && node.end <= end);

  // A top-level function the adapters call and nothing else does is adapter code, wherever it sits
  // in the file: `adfHxOpenFolderTab` exists only to drive one surface's tabs, and the selectors
  // in it are that surface's to change. A helper the steps also call is not — the steps would then
  // be reaching one surface's DOM through it, which is the thing this rule is about.
  const topLevelFunctions = new Map();
  for (const node of ast.body) {
    if (node.type === 'FunctionDeclaration' && node.id) topLevelFunctions.set(node.id.name, node);
    if (node.type === 'VariableDeclaration') {
      for (const decl of node.declarations) {
        if (
          decl.id.type === 'Identifier' &&
          (decl.init?.type === 'ArrowFunctionExpression' ||
            decl.init?.type === 'FunctionExpression')
        ) {
          topLevelFunctions.set(decl.id.name, decl);
        }
      }
    }
  }
  const referencedBy = new Map(); // helper name -> { inAdapter, elsewhere }
  walk(ast, (node) => {
    if (node.type !== 'Identifier' || !topLevelFunctions.has(node.name)) return;
    const declaration = topLevelFunctions.get(node.name);
    if (node.start >= declaration.start && node.end <= declaration.end) return; // its own name
    const seen = referencedBy.get(node.name) ?? { inAdapter: false, elsewhere: false };
    if (within(objectRanges, node)) seen.inAdapter = true;
    else seen.elsewhere = true;
    referencedBy.set(node.name, seen);
  });
  const adapterRanges = [
    ...objectRanges,
    ...[...referencedBy]
      .filter(([, seen]) => seen.inAdapter && !seen.elsewhere)
      .map(([name]) => topLevelFunctions.get(name))
      .map((node) => [node.start, node.end]),
  ];
  const insideAdapter = (node) => within(adapterRanges, node);

  const findings = [];
  const reads = new Map(); // group -> Set(member), every `A.group.member` the steps read

  walk(ast, (node, parents) => {
    // ── unguarded-click ──────────────────────────────────────────────────────────────────────
    if (
      node.type === 'CallExpression' &&
      node.callee.type === 'MemberExpression' &&
      node.callee.property?.type === 'Identifier' &&
      node.callee.property.name === 'click' &&
      !isCaught(node, parents)
    ) {
      findings.push({
        rule: 'unguarded-click',
        line: node.loc.start.line,
        detail:
          'a click with no .catch(): one element another surface renders differently, or covers, ' +
          'ends the whole run on a timeout instead of failing the one check that reads it',
      });
    }

    // ── surface-selector-in-step ─────────────────────────────────────────────────────────────
    if (
      node.type === 'CallExpression' &&
      node.callee.type === 'MemberExpression' &&
      node.callee.property?.type === 'Identifier' &&
      SELECTOR_CALLS.has(node.callee.property.name) &&
      !insideAdapter(node)
    ) {
      const [first] = node.arguments;
      const literals =
        first?.type === 'Literal' && typeof first.value === 'string'
          ? [first.value]
          : first?.type === 'TemplateLiteral'
            ? first.quasis.map((q) => q.value.cooked ?? '')
            : [];
      for (const value of literals) {
        if (!SURFACE_ELEMENT.test(value)) continue;
        findings.push({
          rule: 'surface-selector-in-step',
          line: node.loc.start.line,
          detail:
            `${node.callee.property.name}(${JSON.stringify(value.slice(0, 60))}) names a surface's ` +
            'own element from outside an adapter, so the other surface reads the wrong DOM — or none',
        });
      }
    }

    // ── collect every adapter key the steps read ─────────────────────────────────────────────
    // Both shapes. Only `A.group.member` was collected, which missed every key read directly —
    // `A.browse`, `A.present`, `A.crumbHref`, `A.upstream` — so deleting `NXS.crumbHref` produced
    // no finding at all, on the very function the breadcrumb step calls before its guarded click.
    // A top-level key is recorded with no members: `keys.has(key)` is the whole check for it.
    if (
      node.type === 'MemberExpression' &&
      node.object.type === 'Identifier' &&
      node.object.name === 'A' &&
      node.property?.type === 'Identifier' &&
      !node.computed
    ) {
      const key = node.property.name;
      if (!reads.has(key)) reads.set(key, new Set());
    }
    if (
      node.type === 'MemberExpression' &&
      node.object.type === 'MemberExpression' &&
      node.object.object.type === 'Identifier' &&
      node.object.object.name === 'A' &&
      node.object.property?.type === 'Identifier' &&
      node.property?.type === 'Identifier' &&
      !node.computed &&
      !node.object.computed
    ) {
      const group = node.object.property.name;
      if (!reads.has(group)) reads.set(group, new Set());
      reads.get(group).add(node.property.name);
    }
  });

  // ── adapter-gap ────────────────────────────────────────────────────────────────────────────
  let keysBySurface;
  try {
    keysBySurface = new Map(
      [...surfaces].map(([id, surface]) => {
        try {
          return [id, adapterKeys(surface.object, objects)];
        } catch (error) {
          if (error instanceof UnresolvedSpread) {
            error.message = `surface "${id}" (${surface.name}): ${error.message}`;
          }
          throw error;
        }
      }),
    );
  } catch (error) {
    if (!(error instanceof UnresolvedSpread)) throw error;
    return {
      file: rel,
      unparsable:
        `${error.message}. A spread this audit cannot follow may overwrite inherited keys at run ` +
        'time, so the adapter is refused rather than audited with keys it may not have',
      findings: [],
    };
  }
  // The keys some surface defines as a group of selectors. The scalar exemption below is for a
  // value like `knownGaps: new Set(…)`, where `A.knownGaps.has(…)` is a method call rather than an
  // adapter key — but `adapterKeys` represents *every* non-object value as having no keys, so the
  // exemption also excused `search: null` opposite a real `search: { pageSize }`, and a step
  // reading `A.search.pageSize` got no finding on a surface where it will throw. A key another
  // surface defines as a group is a group, and a scalar in its place is a gap.
  const groupKeys = new Set();
  for (const keys of keysBySurface.values()) {
    for (const [group, members] of keys) if (members !== null) groupKeys.add(group);
  }
  for (const [id, surface] of surfaces) {
    const keys = keysBySurface.get(id);
    for (const [group, members] of reads) {
      if (!keys.has(group)) {
        findings.push({
          rule: 'adapter-gap',
          line: surface.object.loc.start.line,
          detail: `surface "${id}" (${surface.name}) defines no "${group}", which the steps read`,
        });
        continue;
      }
      if (keys.get(group) === null) {
        if (!groupKeys.has(group)) continue; // a scalar everywhere: a value, not a group of keys
        findings.push({
          rule: 'adapter-gap',
          line: surface.object.loc.start.line,
          detail:
            `surface "${id}" (${surface.name}) defines "${group}" as a value, but another surface ` +
            `defines it as a group of selectors and the steps read ${[...members]
              .map((m) => `"${group}.${m}"`)
              .join(', ')} from it`,
        });
        continue;
      }
      for (const member of members) {
        if (!keys.get(group).has(member)) {
          findings.push({
            rule: 'adapter-gap',
            line: surface.object.loc.start.line,
            detail: `surface "${id}" (${surface.name}) defines no "${group}.${member}", which the steps read`,
          });
        }
      }
    }
  }

  findings.sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
  return { file: rel, findings, surfaces: [...surfaces.keys()] };
}

const files = explicit.length > 0 ? explicit : DEFAULT_FILES;
const results = [];
for (const file of files) results.push(await auditFile(file));

const broken = results.filter((r) => r.unreadable || r.unparsable);
const failing = results.filter((r) => r.findings.length > 0);
const total = results.reduce((n, r) => n + r.findings.length, 0);

if (asJson) {
  console.log(
    JSON.stringify(
      {
        verdict: broken.length > 0 || total > 0 ? 'fail' : 'pass',
        files: results,
        findings: total,
        declaredLimits: DECLARED_LIMITS,
      },
      null,
      2,
    ),
  );
} else {
  for (const result of results) {
    if (result.unreadable) {
      console.error(`  ${result.file}: cannot be read — ${result.unreadable}`);
      continue;
    }
    if (result.unparsable) {
      console.error(`  ${result.file}: cannot be audited — ${result.unparsable}`);
      continue;
    }
    console.log(`  ${result.file}  surfaces: ${result.surfaces.join(', ')}`);
    for (const finding of result.findings) {
      console.log(`    ${result.file}:${finding.line}  ${finding.rule}\n      ${finding.detail}`);
    }
  }
  console.log(
    broken.length > 0 || total > 0
      ? `\nparity-surface-audit: fail — ${total} finding(s) in ${failing.length} file(s)` +
          `${broken.length > 0 ? `, ${broken.length} file(s) unreadable or unparsable` : ''}`
      : '\nparity-surface-audit: pass — every surface-specific selector is in an adapter, every ' +
          'adapter key the steps read is defined, and no click can end the run',
  );
  console.log('\n  NOT claimed by this audit:');
  for (const limit of DECLARED_LIMITS) console.log(`    - ${limit}`);
}

process.exit(broken.length > 0 ? 2 : total > 0 ? 1 : 0);
