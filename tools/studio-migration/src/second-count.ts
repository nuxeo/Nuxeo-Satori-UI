/**
 * The second count of a package's constructs, made from the raw text with patterns and sharing
 * no code with the parser behind the inventory.
 *
 * Check 1 requires the two counts to agree (docs/business-apps/studio-migration.md, section 6).
 * The inventory, the converter and the harness all read the same parse, so a construct the parser
 * misses would be missing from all three and nothing would notice. Counting again, another way,
 * is what notices. A disagreement does not say which count is wrong; it says a person must look.
 */
import { COUNTED_KINDS, type ConstructKind } from './constructs';
import type { FileKind, Inventory } from './inventory';
import type { StudioPackage } from './studio-package';

/** Each pattern counts one construct in one kind of file, once comments are out of the text. */
const ROLE_WIDGET = /\s[Rr][Oo][Ll][Ee]\s*=\s*(?:"widget"|'widget'|widget(?=[\s/>]))/;
/** A start tag, read attribute by attribute so that a `>` inside a quoted value does not end it. */
const START_TAG =
  /<[A-Za-z][\w:-]*(?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*\s*\/?>/g;
const tag = (name: string): RegExp => new RegExp(`<${name}(?=[\\s/>])`, 'gi');

/**
 * The elements marked `role="widget"`, counted tag by tag. A field is an element, not an
 * attribute: a tag that writes the attribute twice is one field, as the HTML parser keeps it, and
 * the sample package has one such tag.
 */
function fieldTags(text: string): number {
  return [...text.matchAll(START_TAG)].filter(([start]) => ROLE_WIDGET.test(start)).length;
}
const SCRIPT = tag('script');
const STYLE_BLOCK = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
const CUSTOM_PROPERTY = /(?:^|[{;\s])--[\w-]+\s*:/g;
const JSON_KEY = /"(?:[^"\\]|\\.)*"\s*:/g;

const PATTERNS: Partial<
  Record<FileKind, Partial<Record<ConstructKind, (text: string) => number>>>
> = {
  'document-layout': { 'layout-field': fieldTags, script: count(SCRIPT) },
  'search-form': { 'search-field': fieldTags, script: count(SCRIPT) },
  'search-results': {
    'search-field': fieldTags,
    'search-column': count(tag('nuxeo-data-table-column')),
    script: count(SCRIPT),
  },
  'slot-contributions': {
    'slot-contribution': count(tag('nuxeo-slot-content')),
    script: count(SCRIPT),
  },
  dashboard: { 'dashboard-card': count(tag('nuxeo-card')), script: count(SCRIPT) },
  theme: { 'theme-property': countThemeProperties, script: count(SCRIPT) },
};

/** The same keys as `countsOf` in `constructs.ts`: `<kind> <file>`, for counts above zero. */
export function secondCount(pkg: StudioPackage, inventory: Inventory): Map<string, number> {
  const counts = new Map<string, number>();
  const set = (kind: ConstructKind, file: string, value: number): void => {
    if (value > 0 && COUNTED_KINDS.includes(kind)) counts.set(`${kind} ${file}`, value);
  };
  for (const file of inventory.files) {
    if (file.location !== 'bundle') continue;
    const raw = pkg.bundleFiles.get(file.path)?.toString('utf8') ?? '';
    if (file.kind === 'translations') {
      // JSON has no comments: every quoted string followed by a colon is a key.
      set('translation', file.path, count(JSON_KEY)(raw));
      continue;
    }
    const patterns = PATTERNS[file.kind];
    if (!patterns) continue;
    const text = withoutHtmlComments(raw);
    for (const [kind, counter] of Object.entries(patterns) as [
      ConstructKind,
      (text: string) => number,
    ][]) {
      set(kind, file.path, counter(text));
    }
  }
  return counts;
}

function count(pattern: RegExp): (text: string) => number {
  return (text) => [...text.matchAll(new RegExp(pattern.source, pattern.flags))].length;
}

/**
 * The custom properties declared in a theme's style blocks. A Polymer mixin is one property, so a
 * mixin's block is emptied before counting, and comments go first.
 */
function countThemeProperties(text: string): number {
  let total = 0;
  for (const [, css] of text.matchAll(STYLE_BLOCK)) {
    total += count(CUSTOM_PROPERTY)(withoutMixinBlocks(withoutCssComments(css)));
  }
  return total;
}

/** The text with every `<!-- … -->` taken out, scanning rather than replacing. */
export function withoutHtmlComments(text: string): string {
  let kept = '';
  let at = 0;
  for (let open = text.indexOf('<!--'); open !== -1; open = text.indexOf('<!--', at)) {
    kept += text.slice(at, open);
    const close = text.indexOf('-->', open + 4);
    if (close === -1) return kept;
    at = close + 3;
  }
  return kept + text.slice(at);
}

function withoutCssComments(css: string): string {
  let kept = '';
  let at = 0;
  for (let open = css.indexOf('/*'); open !== -1; open = css.indexOf('/*', at)) {
    kept += css.slice(at, open);
    const close = css.indexOf('*/', open + 2);
    if (close === -1) return kept;
    at = close + 2;
  }
  return kept + css.slice(at);
}

/** `--name: { … }` becomes `--name: {}`, braces nested inside the block included. */
function withoutMixinBlocks(css: string): string {
  const mixin = /--[\w-]+\s*:\s*\{/g;
  let kept = '';
  let at = 0;
  for (let match = mixin.exec(css); match; match = mixin.exec(css)) {
    if (match.index < at) continue;
    let depth = 1;
    let end = match.index + match[0].length;
    while (end < css.length && depth > 0) {
      if (css[end] === '{') depth++;
      if (css[end] === '}') depth--;
      end++;
    }
    kept += `${css.slice(at, match.index + match[0].length)}}`;
    at = end;
    mixin.lastIndex = end;
  }
  return kept + css.slice(at);
}
