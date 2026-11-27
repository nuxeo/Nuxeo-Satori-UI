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
const IS_DOM_IF = /\s[Ii][Ss]\s*=\s*(?:"\s*dom-if\s*"|'\s*dom-if\s*'|dom-if(?=[\s/>]))/;
/** A `nuxeo-filter`, a `dom-if`, or a template written `is="dom-if"`. */
function conditionTags(text: string): number {
  return (
    count(tag('nuxeo-filter'))(text) +
    count(tag('dom-if'))(text) +
    [...text.matchAll(START_TAG)].filter(
      ([start]) => /^<template\b/i.test(start) && IS_DOM_IF.test(start),
    ).length
  );
}
/** The result views: a table, a grid of thumbnails, a justified grid. */
const VIEWS = (text: string): number =>
  ['nuxeo-data-table', 'nuxeo-data-grid', 'nuxeo-justified-grid'].reduce(
    (total, name) => total + count(tag(name))(text),
    0,
  );
const STYLE_BLOCK = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
const CUSTOM_PROPERTY = /(?:^|[{;\s])--[\w-]+\s*:/g;
const JSON_KEY = /"(?:[^"\\]|\\.)*"\s*:/g;

const PATTERNS: Partial<
  Record<FileKind, Partial<Record<ConstructKind, (text: string) => number>>>
> = {
  'document-layout': {
    'layout-field': fieldTags,
    condition: conditionTags,
    script: count(SCRIPT),
  },
  'task-layout': {
    'task-field': fieldTags,
    condition: conditionTags,
    script: count(SCRIPT),
  },
  // A block's fields are counted where it is used, below.
  'layout-block': { condition: conditionTags, script: count(SCRIPT) },
  'search-form': { 'search-field': fieldTags, condition: conditionTags, script: count(SCRIPT) },
  'search-results': {
    'search-field': fieldTags,
    'search-column': count(tag('nuxeo-data-table-column')),
    'search-view': VIEWS,
    condition: conditionTags,
    script: count(SCRIPT),
  },
  'slot-contributions': {
    'slot-contribution': count(tag('nuxeo-slot-content')),
    condition: conditionTags,
    script: count(SCRIPT),
  },
  // The custom bundle may hold contributions as the bundle does, beside its code. Its custom
  // elements are counted whole, and what they hold is theirs, not the file's.
  'custom-bundle': {
    'custom-element': (text) => elementSpans(text).length,
    'slot-contribution': (text) => count(tag('nuxeo-slot-content'))(withoutElements(text)),
    condition: (text) => conditionTags(withoutElements(text)),
    script: (text) => count(SCRIPT)(withoutElements(text)),
  },
  dashboard: {
    'dashboard-card': count(tag('nuxeo-card')),
    condition: conditionTags,
    script: count(SCRIPT),
  },
  theme: {
    'theme-property': countThemeProperties,
    condition: conditionTags,
    script: count(SCRIPT),
  },
};

/** The Web UI files a layout block can be used in: those the parser reads as Polymer markup. */
const WEB_UI_KINDS: ReadonlySet<FileKind> = new Set<FileKind>([
  'custom-bundle',
  'document-layout',
  'task-layout',
  'layout-block',
  'search-form',
  'search-results',
  'slot-contributions',
  'dashboard',
  'theme',
]);
const DOM_MODULE_ID =
  /<dom-module\s(?:[^>"']|"[^"]*"|'[^']*')*?\bid\s*=\s*(?:"([^"]*)"|'([^']*)')/i;
const TAG_NAME = /^<([A-Za-z][\w:-]*)/;

/** The same keys as `countsOf` in `constructs.ts`: `<kind> <file>`, for counts above zero. */
export function secondCount(pkg: StudioPackage, inventory: Inventory): Map<string, number> {
  const counts = new Map<string, number>();
  const set = (kind: ConstructKind, file: string, value: number): void => {
    if (value > 0 && COUNTED_KINDS.includes(kind)) counts.set(`${kind} ${file}`, value);
  };
  // The layout blocks, by the element each defines, with the fields each holds: read from their
  // own text. Only the file kinds come from the inventory.
  const blocks = new Map<string, number>();
  for (const file of inventory.files) {
    if (file.location !== 'bundle' || file.kind !== 'layout-block') continue;
    const text = withoutHtmlComments(pkg.bundleFiles.get(file.path)?.toString('utf8') ?? '');
    const match = DOM_MODULE_ID.exec(text);
    const id = (match?.[1] ?? match?.[2] ?? '').trim().toLowerCase();
    if (id && !blocks.has(id)) blocks.set(id, fieldTags(text));
  }
  for (const file of inventory.files) {
    if (file.location !== 'bundle') continue;
    const raw = pkg.bundleFiles.get(file.path)?.toString('utf8') ?? '';
    if (WEB_UI_KINDS.has(file.kind) && blocks.size > 0) {
      // Each tag named as a block is a use of it, which shows the block's fields once more.
      // A custom element's own template is the element's: a block it uses is not the file's.
      const outside =
        file.kind === 'custom-bundle'
          ? withoutElements(withoutHtmlComments(raw))
          : withoutHtmlComments(raw);
      const uses = [...outside.matchAll(START_TAG)]
        .map(([start]) => TAG_NAME.exec(start)?.[1]?.toLowerCase() ?? '')
        .filter((name) => blocks.has(name));
      set('block-use', file.path, uses.length);
      set(
        'block-field',
        file.path,
        uses.reduce((total, name) => total + (blocks.get(name) ?? 0), 0),
      );
    }
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

/**
 * The custom elements a custom bundle's text defines: each `<dom-module>` with a custom element's
 * `id`, up to its `</dom-module>`, that holds a `<script>`. Read from the text, as the rest of this
 * count is, and never from the parser's elements.
 */
function elementSpans(text: string): (readonly [number, number])[] {
  const spans: (readonly [number, number])[] = [];
  const open = /<dom-module(?=[\s/>])/gi;
  for (let match = open.exec(text); match; match = open.exec(text)) {
    const start = match.index;
    const tagEnd = startTagEnd(text, start);
    const close = text.toLowerCase().indexOf('</dom-module', tagEnd);
    const end = close === -1 ? text.length : text.indexOf('>', close) + 1 || text.length;
    const startTag = text.slice(start, tagEnd);
    const id = DOM_MODULE_ID.exec(startTag);
    const name = (id?.[1] ?? id?.[2] ?? '').trim();
    if (
      /^[a-z][a-z0-9._-]*-[a-z0-9._-]*$/.test(name) &&
      /<script(?=[\s/>])/i.test(text.slice(tagEnd, end))
    )
      spans.push([start, end]);
    open.lastIndex = end;
  }
  return spans;
}

/** Where the start tag that begins at `start` ends, a `>` inside a quoted value not ending it. */
function startTagEnd(text: string, start: number): number {
  const pattern = new RegExp(START_TAG.source, 'y');
  pattern.lastIndex = start;
  const match = pattern.exec(text);
  return match ? start + match[0].length : start + 1;
}

/** The text with the custom elements' definitions taken out. */
function withoutElements(text: string): string {
  let kept = '';
  let at = 0;
  for (const [start, end] of elementSpans(text)) {
    kept += text.slice(at, start);
    at = end;
  }
  return kept + text.slice(at);
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
