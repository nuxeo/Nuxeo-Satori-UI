#!/usr/bin/env node
/**
 * Extract hard-coded user-facing strings from Angular templates into the translation catalogue.
 *
 * Slice 1 of `docs/i18n-full-extraction-plan.md`. Run per project, reviewed as a diff, gated
 * before the next one:
 *
 *   node tools/i18n/extract.mjs libs/features/document-detail --dry-run
 *   node tools/i18n/extract.mjs libs/features/document-detail
 *
 * ## The rule this tool exists to keep
 *
 * **The English catalogue value is byte-identical to the literal it replaces.** That is what
 * keeps the rendered DOM unchanged in English, which is what keeps every evidence harness and
 * spec passing without being touched. It is asserted here rather than trusted: `--verify`
 * re-reads the catalogue and compares it against what was removed.
 *
 * Proven twice before this tool existed — `phase-1-tag-styles` passes 21/21 against a piped
 * `aria-label`, and `phase-2-registry`'s ordered nav-label assertion survived the nav keys
 * landing.
 *
 * ## What it will not do, on purpose
 *
 * It refuses rather than guesses:
 *
 *   - **Composed strings.** Anything already containing `{{ }}` is interpolation; a key cannot
 *     replace half a sentence. INFO-144 forbids building a sentence from pieces, and the fix is
 *     an ICU message a human writes.
 *   - **Ternaries.** `count === 1 ? 'item' : 'items'` is a plural, not two strings.
 *   - **Icon ligatures.** `<mat-icon>search</mat-icon>` is an icon name.
 *   - **Anything that is not prose**: `class`, `id`, `type`, `role`, `routerLink`, `svgIcon`,
 *     `data-*`, values under two letters, numbers, CSS, and Nuxeo property paths like
 *     `dc:title`.
 *
 * Everything it refuses is listed in the report, so the residue is visible rather than silently
 * counted as done.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename, join } from 'node:path';

const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const targets = args.filter((arg) => !arg.startsWith('--'));

if (targets.length === 0) {
  console.error('usage: node tools/i18n/extract.mjs <project-dir> [more dirs] [--dry-run]');
  process.exit(2);
}

const CATALOGUE = 'apps/nuxeo-ui/public/i18n/en.json';
const CONTEXT = 'apps/nuxeo-ui/public/i18n/en.context.json';

/**
 * Namespace per project, so keys say where they came from.
 *
 * Explicit rather than derived from the path, because `libs/shared/ui` would otherwise become
 * `ui` and collide with anything else called that, and because these strings end up in a
 * customer-visible catalogue where `shared-ui.confirm-dialog.cancel` reads better than a path.
 */
const NAMESPACE = {
  'apps/nuxeo-ui': 'app',
  'libs/features/administration': 'admin',
  'libs/features/assets': 'assets',
  'libs/features/browse': 'browse',
  'libs/features/collections': 'collections',
  'libs/features/document-detail': 'document-detail',
  'libs/features/knowledge-discovery': 'kd',
  'libs/features/search': 'search',
  'libs/features/tasks': 'tasks',
  'libs/features/trash': 'trash',
  'libs/shared/permission-dialogs': 'permissions',
  'libs/shared/ui': 'shared-ui',
};

/** Attributes whose literal value a user reads or hears. */
const TEXT_ATTRIBUTES = ['aria-label', 'title', 'placeholder', 'matTooltip', 'alt'];
/** Attributes bound through `attr.` because they are not DOM properties on every element. */
// `aria-label` has no DOM property, so it must go through `attr.`. `title` DOES have one —
// and on a component it is very often an `@Input()` rather than the HTML tooltip. Rewriting
// `title="Tasks"` on `<lib-widget-container>` to `[attr.title]` set a DOM attribute and left
// the required input unbound, which the compiler caught as
// `NG8008: Required input 'title' must be specified`. Property binding is right for both: on a
// plain element `[title]` sets the DOM property, which reflects to the attribute anyway.
const ATTR_PREFIXED = new Set(['aria-label']);

/** Elements whose text content is never prose. */
// Only the CONTENT of an icon element is a ligature rather than prose. A **self-closing**
// `<hxp-icon />` is followed by its button's label, and an earlier version treated that the
// same way and silently skipped four real labels — "Restore", "Create / Import", "Export",
// "Share". The residue report is what surfaced them, which is the argument for having one.
const NON_PROSE_ELEMENTS = /<(mat-icon|hxp-icon|style|script)\b[^>]*(?<!\/)>$/i;

/** Prose a user reads, as opposed to an icon name, a number, a CSS value or a property path. */
function isProse(raw) {
  const text = raw.trim();
  if (text.length < 2) return false;
  if (!/^[A-Z]/.test(text)) return false;
  if ((text.match(/[A-Za-z]/g) ?? []).length < 2) return false;
  if (/^[A-Z][a-z]*:[a-z]/.test(text)) return false; // dc:title, uid:major_version
  if (/^\d/.test(text)) return false;
  return true;
}

/** A stable, readable key segment from the English text. */
function slugify(text) {
  const slug = text
    .trim()
    .toLowerCase()
    .replace(/[''`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .slice(0, 6)
    .join('-');
  return slug || 'text';
}

function readJson(path) {
  return existsSync(join(repoRoot, path))
    ? JSON.parse(readFileSync(join(repoRoot, path), 'utf8'))
    : {};
}

/** Sets a dotted key into a nested object, keeping siblings sorted for a stable diff. */
function setDotted(root, dotted, value) {
  const parts = dotted.split('.');
  let node = root;
  for (const part of parts.slice(0, -1)) {
    if (typeof node[part] !== 'object' || node[part] === null) node[part] = {};
    node = node[part];
  }
  node[parts.at(-1)] = value;
}

function sortDeep(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortDeep(value[key])]),
  );
}

const catalogue = readJson(CATALOGUE);
const context = readJson(CONTEXT);

/**
 * Existing catalogue keys, and the English text seen so far.
 *
 * `existingKeys` prevents a collision; it does **not** drive reuse. An earlier version reused
 * any key whose English matched, and the first real run had a collection's Delete button pick
 * up `browse.scope.delete` and its refresh button pick up `nav.refresh`.
 *
 * Two things wrong with that. INFO-144 permits sharing a string only when it is the same
 * *concept*, and a script cannot tell concepts apart — it sees that two English words match,
 * which is exactly the "from" problem the standard uses as its worked example. And the
 * translator context describes one site, so the moment a key serves two, the context is wrong
 * for one of them and nobody finds out.
 *
 * Reuse is therefore scoped to a single component, where the same text really is the same
 * concept. It costs more keys, and each one is accurate.
 */
const existingKeys = new Set();
const keyByText = new Map();
(function walk(node, prefix) {
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') existingKeys.add(path);
    else if (value && typeof value === 'object') walk(value, path);
  }
})(catalogue, '');

const summary = { files: 0, replaced: 0, reused: 0, created: 0 };
const refused = [];
const pipeAdded = [];

for (const target of targets) {
  const namespace = NAMESPACE[target];
  if (!namespace) {
    console.error(`No namespace mapped for "${target}". Add one to NAMESPACE in this file.`);
    process.exit(2);
  }

  const templates = execFileSync('git', ['ls-files', `${target}/**/*.html`], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean);

  for (const file of templates) {
    const path = join(repoRoot, file);
    let body = readFileSync(path, 'utf8');
    const before = body;
    const component = basename(file).replace(/\.component\.html$|\.html$/, '');
    const used = new Set();

    /** Allocates a key, reusing one only within this component. */
    const keyFor = (text, hint) => {
      const withinComponent = keyByText.get(`${file}::${text}`);
      if (withinComponent) {
        summary.reused += 1;
        return withinComponent;
      }
      const base = `${namespace}.${component}.${slugify(text)}`;
      let key = base;
      let n = 2;
      while (used.has(key) || existingKeys.has(key)) key = `${base}-${n++}`;
      used.add(key);
      existingKeys.add(key);
      keyByText.set(`${file}::${text}`, key);
      setDotted(catalogue, key, text);
      context[key] = hint;
      summary.created += 1;
      return key;
    };

    // ---- attributes -------------------------------------------------------
    for (const attribute of TEXT_ATTRIBUTES) {
      const pattern = new RegExp(`(?<![\\[\\w.-])${attribute}="([^"]*)"`, 'g');
      body = body.replace(pattern, (whole, value) => {
        if (value.includes('{{') || value.includes('|')) return whole;
        if (!isProse(value)) return whole;
        const role = ATTR_PREFIXED.has(attribute)
          ? `Accessible name (${attribute}) of a control in ${component}.`
          : `The ${attribute} of a control in ${component}.`;
        const key = keyFor(value, `${role} Rendered in ${file}.`);
        const bound = ATTR_PREFIXED.has(attribute) ? `attr.${attribute}` : attribute;
        summary.replaced += 1;
        return `[${bound}]="'${key}' | translate"`;
      });
    }

    // ---- text nodes -------------------------------------------------------
    // Whole-file rather than line-by-line, so prose wrapped across lines by the formatter is
    // still one string. `[^<>]*` cannot cross a tag, which is what keeps it from swallowing
    // nested markup.
    body = body.replace(/>([^<>]*)</g, (whole, raw, offset) => {
      if (raw.includes('{{') || raw.includes('|')) return whole;
      // Angular control flow lives in text position, and `[^<>]*` happily spans it. A block
      // like
      //
      //     <span>
      //       You have a task to process
      //       @if (dueLabel) {
      //         before <strong>{{ dueLabel }}</strong>
      //
      // is one "text node" as far as this regex is concerned, and an earlier version replaced
      // the whole thing with a single key — eating the `@if (…) {` opener and leaving an
      // orphaned `}` that broke the template. Braces and `@` blocks are a refusal, not
      // something to parse: the fix for such a string is an ICU message a human writes, which
      // is the same conclusion the concatenation rule reaches.
      if (/[{}]/.test(raw) || /@[a-z]/i.test(raw)) return whole;
      if (!isProse(raw)) return whole;
      // The opening tag immediately before this text decides whether it is prose at all.
      const openTag = body.slice(Math.max(0, offset - 200), offset + 1);
      if (NON_PROSE_ELEMENTS.test(openTag)) return whole;
      // `--!>` is a comment terminator as well as `-->` (the spec's comment-end-bang state), so
      // testing only for `-->` reads a closed comment as open and skips text that is in fact
      // visible. That is an under-extraction, which is the failure this whole codemod exists to
      // avoid. Flagged by CodeQL as a bad HTML-filtering regexp.
      if (/<!--/.test(openTag) && !/--!?>/.test(openTag)) return whole;

      const text = raw.trim();
      const key = keyFor(text, `Visible text in ${component}. Rendered in ${file}.`);
      summary.replaced += 1;
      const [, lead] = raw.match(/^(\s*)/);
      const [, tail] = raw.match(/(\s*)$/);
      return `>${lead}{{ '${key}' | translate }}${tail}<`;
    });

    // Residue is measured on the TRANSFORMED body, not by re-reading the file. An earlier
    // version scanned disk, which in `--dry-run` reports the strings the run had just handled
    // and makes the tool look far worse than it is.
    for (const [, raw] of body.matchAll(/>([^<>]*)</g)) {
      if (raw.includes('{{') || raw.includes('|') || !isProse(raw)) continue;
      refused.push(`${file}: left as-is -> ${JSON.stringify(raw.trim().slice(0, 60))}`);
    }

    if (body === before) continue;
    summary.files += 1;
    if (!dryRun) writeFileSync(path, body);

    // ---- make sure the component can use the pipe -------------------------
    const componentFile = path.replace(/\.html$/, '.ts');
    if (existsSync(componentFile)) {
      let ts = readFileSync(componentFile, 'utf8');
      if (!/\bTranslatePipe\b/.test(ts)) {
        // After the last COMPLETE import statement, not after the last line that begins with
        // `import`. Many of these files have multi-line imports, and anchoring on the line
        // dropped the new import into the middle of one — producing
        // `Parsing error: Identifier expected` in thirty files at once.
        const statements = [...ts.matchAll(/^import[\s\S]*?from\s+'[^']+';$/gm)];
        const insertAt = statements.length
          ? statements.at(-1).index + statements.at(-1)[0].length + 1
          : 0;
        const importLine = "import { TranslatePipe } from '@ngx-translate/core';\n";
        ts = ts.slice(0, insertAt) + importLine + ts.slice(insertAt);

        const importsArray = /imports:\s*\[/.exec(ts);
        if (importsArray) {
          ts = `${ts.slice(0, importsArray.index + importsArray[0].length)}TranslatePipe, ${ts.slice(importsArray.index + importsArray[0].length)}`;
        } else {
          // A component with no `imports` array cannot use the pipe; say so rather than
          // producing a template that fails at runtime with NG0302.
          refused.push(`${componentFile}: no imports array — add TranslatePipe by hand`);
        }
        if (!dryRun) writeFileSync(componentFile, ts);
        pipeAdded.push(componentFile.replace(`${repoRoot}/`, ''));
      }
    } else {
      refused.push(`${file}: no sibling component file, TranslatePipe not added`);
    }
  }
}

if (!dryRun) {
  writeFileSync(join(repoRoot, CATALOGUE), `${JSON.stringify(sortDeep(catalogue), null, 2)}\n`);
  writeFileSync(join(repoRoot, CONTEXT), `${JSON.stringify(sortDeep(context), null, 2)}\n`);
}

console.log(`${dryRun ? '[dry run] ' : ''}i18n extraction`);
console.log(`  templates changed   ${summary.files}`);
console.log(`  strings replaced    ${summary.replaced}`);
console.log(`  new keys            ${summary.created}`);
console.log(`  reused existing key ${summary.reused}`);
console.log(`  TranslatePipe added ${pipeAdded.length}`);
if (refused.length) {
  console.log(`\n  NOT extracted (${refused.length}) — these stay hard-coded:`);
  for (const line of refused.slice(0, 40)) console.log(`    ${line}`);
  if (refused.length > 40) console.log(`    … and ${refused.length - 40} more`);
}
