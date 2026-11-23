/**
 * What a Studio package holds, file by file and construct by construct.
 *
 * This is the ground truth the migration harness's first check holds every report against
 * (docs/business-apps/studio-migration.md, section 6, check 1): nothing in a package may be
 * dropped silently. So every file gets a kind, and one that matches no known kind is listed as
 * `unrecognised` rather than skipped; a file that cannot be read is listed in `problems` rather
 * than ending the run.
 */
import {
  attributesOf,
  childLabel,
  elementsOf,
  isCustomElement,
  parseHtml,
  parseXml,
} from './markup';
import { scriptShape } from './script-shape';
import type { StudioPackage, StudioPackageDescriptor } from './studio-package';
import { themeProperties, type ThemeProperty } from './theme';

export type FileKind =
  | 'package-descriptor'
  | 'package-install'
  | 'package-registries'
  | 'bundle'
  | 'bundle-manifest'
  | 'deployment-fragment'
  | 'model-contributions'
  | 'model-schema'
  | 'document-layout'
  | 'search-form'
  | 'search-results'
  | 'slot-contributions'
  | 'custom-bundle'
  | 'dashboard'
  | 'theme'
  | 'theme-asset'
  | 'translations'
  | 'translations-jsf'
  | 'image'
  | 'studio-metadata'
  | 'unrecognised';

export interface InventoryFile {
  readonly path: string;
  /** `package` for the Nuxeo package's own files, `bundle` for those inside the bundle. */
  readonly location: 'package' | 'bundle';
  readonly kind: FileKind;
  readonly bytes: number;
}

export interface LayoutField {
  /** The element marked `role="widget"`. */
  readonly element: string;
  /** The document property it binds, as `<prefix>:<field>`, or the search parameter it fills. */
  readonly binding: string | null;
  readonly label: string | null;
  readonly required: boolean;
  /** The element's attributes, which give its widget's parameters, such as `directory-name`. */
  readonly attributes: Readonly<Record<string, string>>;
  /** The condition it sits in, by its place among its file's conditions, from 0; `null` for none. */
  readonly condition: number | null;
}

/**
 * A condition: a `nuxeo-filter`, or a `dom-if`, which shows what it holds only while it passes.
 * Studio writes filters around buttons and fields; M2 turns them into registered rules.
 */
export interface Condition {
  readonly path: string;
  /** Its place among its file's conditions, from 0. */
  readonly index: number;
  /** `nuxeo-filter`, `dom-if`, or `template` for `<template is="dom-if">`. */
  readonly element: string;
  readonly attributes: Readonly<Record<string, string>>;
}

/** A column of a list of results, or of a dashboard card's list. */
export interface ResultColumn {
  /** Its heading, as written. */
  readonly name: string | null;
  /** Its `field`, or else the property its template shows. */
  readonly field: string | null;
  readonly sortBy: string | null;
  /** The custom elements its template holds, which say how it shows the value. */
  readonly elements: readonly string[];
  /** The `format` of a `nuxeo-date` it holds. */
  readonly dateFormat: string | null;
  /** True when its template writes the value through `formatDate`. */
  readonly formatsDate: boolean;
  /** True when it sits in a condition, or its template holds one: it then shows only to some. */
  readonly conditional: boolean;
}

/** A sort a results layout offers, from the options Studio's script writes. */
export interface SortOption {
  readonly field: string;
  readonly order: 'asc' | 'desc';
  /** The one the results open sorted by. */
  readonly selected: boolean;
}

export interface DocumentLayout {
  readonly path: string;
  /** The `dom-module` id. */
  readonly element: string;
  /** From the layout's `@doctype` annotation. */
  readonly docType: string | null;
  /** From the file name: `create`, `edit`, `import`, `metadata`, `view`, or another. */
  readonly mode: string;
  readonly fields: readonly LayoutField[];
}

export interface SearchLayout {
  readonly path: string;
  readonly element: string;
  /** From the layout's `@search` annotation: the page provider it searches. */
  readonly provider: string | null;
  readonly part: 'form' | 'results';
  readonly fields: readonly LayoutField[];
  readonly columns: number;
  /** The columns of its table, in order: `columns` of them. */
  readonly columnDetails: readonly ResultColumn[];
  /**
   * The result views it offers, in the order it writes them: `nuxeo-data-table`,
   * `nuxeo-data-grid`, `nuxeo-justified-grid`.
   */
  readonly views: readonly string[];
  /** For each of `views`, whether it sits in a condition, or holds one. */
  readonly conditionalViews: readonly boolean[];
  /** For results: the sorts its script offers. */
  readonly sortOptions: readonly SortOption[];
}

export interface SlotContribution {
  readonly path: string;
  readonly name: string;
  readonly slot: string;
  readonly order: number | null;
  /** The custom elements its template holds. */
  readonly elements: readonly string[];
  /** For each `nuxeo-operation-button` it holds, the operation it runs, or `null` for none. */
  readonly operations: readonly (string | null)[];
  /** The custom elements its template holds, with their attributes, in order. */
  readonly parts: readonly {
    readonly element: string;
    readonly attributes: Readonly<Record<string, string>>;
  }[];
  /** The conditions its template holds, by their place among the file's conditions. */
  readonly conditions: readonly number[];
}

export interface DashboardCard {
  readonly heading: string | null;
  readonly elements: readonly string[];
  /** The index of an earlier card with the same heading and content, which this one repeats. */
  readonly repeatOf: number | null;
  /** The page provider its `nuxeo-page-provider` reads. */
  readonly provider: string | null;
  readonly pageSize: number | null;
  /** That provider's `params`, as written. */
  readonly params: string | null;
  readonly columns: readonly ResultColumn[];
  /** The operation a `nuxeo-operation` in it runs. */
  readonly operation: string | null;
  /** True when it sits in a condition or holds one. */
  readonly conditional: boolean;
}

export interface Dashboard {
  readonly path: string;
  readonly cards: readonly DashboardCard[];
}

export interface Theme {
  /** The theme's folder name, which is the name its `nuxeo-theme` contribution uses. */
  readonly name: string;
  readonly path: string;
  readonly properties: readonly ThemeProperty[];
  /** The other files in its folder, such as its logo. */
  readonly assets: readonly string[];
}

export interface Translations {
  readonly path: string;
  readonly locale: string;
  readonly keys: readonly string[];
}

export interface ModelContribution {
  readonly path: string;
  readonly target: string;
  readonly point: string;
  readonly contributions: number;
}

export interface CustomCode {
  readonly path: string;
  /** False when the file holds only comments, as Studio generates it. */
  readonly hasCode: boolean;
}

/** A `<script>` in a layout, search screen, slot bundle, dashboard or theme. */
export interface ScriptUse {
  readonly path: string;
  /** Its position among the file's scripts, from 0. */
  readonly index: number;
  /** Its shape's SHA-256 (`script-shape.ts`), to compare with the scripts Studio generates. */
  readonly shape: string;
}

export interface InventoryProblem {
  readonly path: string;
  readonly message: string;
}

export interface Inventory {
  readonly descriptor: StudioPackageDescriptor;
  readonly files: readonly InventoryFile[];
  readonly model: readonly ModelContribution[];
  readonly layouts: readonly DocumentLayout[];
  readonly searches: readonly SearchLayout[];
  readonly slotContributions: readonly SlotContribution[];
  readonly customCode: readonly CustomCode[];
  readonly dashboard: Dashboard | null;
  readonly themes: readonly Theme[];
  readonly translations: readonly Translations[];
  /**
   * The custom elements the Web UI files use, by name, with how many times each appears. Counted
   * in the document layouts, the search screens, the slot contributions, the dashboard and the
   * themes, leaving out the two wrappers every such file has, `dom-module` and `custom-style`.
   */
  readonly elements: ReadonlyMap<string, number>;
  /** Every script in those files, so a customer's code in one is never passed over. */
  readonly scripts: readonly ScriptUse[];
  /** Every condition in those files. */
  readonly conditions: readonly Condition[];
  readonly problems: readonly InventoryProblem[];
}

const UI = 'web/nuxeo.war/ui/';

/** First match wins, so the more specific patterns come first. */
const BUNDLE_KINDS: readonly (readonly [RegExp, FileKind])[] = [
  [/^META-INF\/MANIFEST\.MF$/, 'bundle-manifest'],
  [/^OSGI-INF\/deployment-fragment\.xml$/, 'deployment-fragment'],
  [/^OSGI-INF\/[^/]+\.xml$/, 'model-contributions'],
  [/^data\/schemas\/[^/]+\.xsd$/, 'model-schema'],
  [/^data\/i18n\/messages(?:[-_][A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*)?\.json$/, 'translations'],
  [/^data\/i18n\/[^/]+\.properties$/, 'translations-jsf'],
  [/^web\/nuxeo\.war\/ui\/document\/[^/]+\/nuxeo-[^/]+-layout\.html$/, 'document-layout'],
  [/^web\/nuxeo\.war\/ui\/search\/[^/]+\/nuxeo-[^/]+-search-form\.html$/, 'search-form'],
  [/^web\/nuxeo\.war\/ui\/search\/[^/]+\/nuxeo-[^/]+-search-results\.html$/, 'search-results'],
  [/^web\/nuxeo\.war\/ui\/nuxeo-[^/]+-custom-bundle\.html$/, 'custom-bundle'],
  [/^web\/nuxeo\.war\/ui\/nuxeo-[^/]+-bundle\.html$/, 'slot-contributions'],
  [/^web\/nuxeo\.war\/ui\/nuxeo-home\.html$/, 'dashboard'],
  [/^web\/nuxeo\.war\/ui\/themes\/[^/]+\/theme\.html$/, 'theme'],
  [/^web\/nuxeo\.war\/ui\/themes\/[^/]+\/[^/]+$/, 'theme-asset'],
  [/^web\/nuxeo\.war\/img\/[^/]+$/, 'image'],
  [/^\.metadata\/[^/]+$/, 'studio-metadata'],
];

// A Map, not an object: a file named `constructor` or `__proto__` must not find a kind on the
// object's prototype.
const PACKAGE_KINDS: ReadonlyMap<string, FileKind> = new Map([
  ['package.xml', 'package-descriptor'],
  ['install.xml', 'package-install'],
  ['studio-registries.json', 'package-registries'],
]);

const RESULT_VIEWS = ['nuxeo-data-table', 'nuxeo-data-grid', 'nuxeo-justified-grid'];
const WRAPPERS = new Set(['dom-module', 'custom-style']);

export function classify(
  path: string,
  location: 'package' | 'bundle',
  bundlePath: string,
): FileKind {
  if (location === 'package') {
    if (path === bundlePath) return 'bundle';
    return PACKAGE_KINDS.get(path) ?? 'unrecognised';
  }
  return BUNDLE_KINDS.find(([pattern]) => pattern.test(path))?.[1] ?? 'unrecognised';
}

export function inventory(pkg: StudioPackage): Inventory {
  const files: InventoryFile[] = [
    ...[...pkg.packageFiles].map(([path, data]) => ({
      path,
      location: 'package' as const,
      kind: classify(path, 'package', pkg.bundlePath),
      bytes: data.length,
    })),
    ...[...pkg.bundleFiles].map(([path, data]) => ({
      path,
      location: 'bundle' as const,
      kind: classify(path, 'bundle', pkg.bundlePath),
      bytes: data.length,
    })),
  ];

  const problems: InventoryProblem[] = [];
  const elements = new Map<string, number>();
  // Every path asked for comes from the bundle's own listing, so it is always there.
  const read = (path: string): string =>
    (pkg.bundleFiles.get(path) ?? Buffer.alloc(0)).toString('utf8');
  const ofKind = (kind: FileKind): string[] =>
    files
      .filter((file) => file.location === 'bundle' && file.kind === kind)
      .map((file) => file.path);

  const scripts: ScriptUse[] = [];
  const conditions: Condition[] = [];
  /** The condition each element of a file sits in, for the files read so far. */
  const within = new Map<Element, number>();
  /**
   * Parses a Web UI file, counts its custom elements, records its scripts and conditions, and
   * hands its document on.
   */
  const webUi = (path: string): { document: Document; text: string } => {
    const text = read(path);
    const document = parseHtml(text);
    conditions.push(...conditionsOf(path, document, within));
    let index = 0;
    for (const element of elementsOf(document)) {
      if (isCustomElement(element) && !WRAPPERS.has(element.localName)) {
        elements.set(element.localName, (elements.get(element.localName) ?? 0) + 1);
      }
      if (element.localName === 'script') {
        // A script loaded from elsewhere is shaped by where it comes from: it is never a template.
        const src = element.getAttribute('src');
        const source =
          src === null
            ? (element.textContent ?? '')
            : `/* external */ import(${JSON.stringify(src)})`;
        scripts.push({ path, index: index++, shape: scriptShape(source) });
      }
    }
    return { document, text };
  };

  const model: ModelContribution[] = [];
  for (const path of ofKind('model-contributions')) {
    try {
      const root = parseXml(read(path)).documentElement;
      for (const extension of elementsOf(root).filter(
        (element) => element.localName === 'extension',
      )) {
        model.push({
          path,
          target: extension.getAttribute('target') ?? '',
          point: extension.getAttribute('point') ?? '',
          contributions: extension.children.length,
        });
      }
    } catch (error) {
      problems.push({ path, message: `not well-formed XML: ${(error as Error).message}` });
    }
  }

  const layouts: DocumentLayout[] = ofKind('document-layout').map((path) => {
    const { document, text } = webUi(path);
    return {
      path,
      element: moduleId(document, path),
      docType: annotation(text, 'doctype'),
      mode: /-([a-z]+)-layout\.html$/.exec(path)?.[1] ?? '',
      fields: fieldsOf(document, within),
    };
  });

  const parsedSearches = [...ofKind('search-form'), ...ofKind('search-results')]
    .sort()
    .map((path) => {
      const { document, text } = webUi(path);
      const all = elementsOf(document);
      const part = path.endsWith('-search-form.html') ? ('form' as const) : ('results' as const);
      const columns = all.filter((element) => element.localName === 'nuxeo-data-table-column');
      return {
        path,
        element: moduleId(document, path),
        provider: annotation(text, 'search'),
        part,
        fields: fieldsOf(document, within),
        columns: columns.length,
        columnDetails: columns.map((column) => columnOf(column, within)),
        views: all
          .filter((element) => RESULT_VIEWS.includes(element.localName))
          .map((element) => element.localName),
        conditionalViews: all
          .filter((element) => RESULT_VIEWS.includes(element.localName))
          .map((view) => within.has(view)),
        sortOptions:
          part === 'results'
            ? all
                .filter((element) => element.localName === 'script')
                .flatMap((script) => sortOptionsOf(script.textContent ?? ''))
            : [],
      };
    });
  // Studio annotates the form with `@search <provider>` but not always the results, which sit in
  // the same folder: those take their form's provider.
  const folderOf = (path: string): string => path.slice(0, path.lastIndexOf('/'));
  const searches: SearchLayout[] = parsedSearches.map((search) => ({
    ...search,
    provider:
      search.provider ??
      parsedSearches.find(
        (other) => other.provider && folderOf(other.path) === folderOf(search.path),
      )?.provider ??
      null,
  }));

  const slotContributions: SlotContribution[] = ofKind('slot-contributions').flatMap((path) =>
    elementsOf(webUi(path).document)
      .filter((element) => element.localName === 'nuxeo-slot-content')
      .map((element) => {
        const order = element.getAttribute('order');
        const inner = elementsOf(element);
        return {
          path,
          name: element.getAttribute('name') ?? '',
          slot: element.getAttribute('slot') ?? '',
          order: order !== null && /^-?\d+$/.test(order.trim()) ? Number(order) : null,
          elements: elementsOf(element)
            .filter(isCustomElement)
            .map((inner) => inner.localName),
          operations: inner
            .filter((part) => part.localName === 'nuxeo-operation-button')
            .map((button) => button.getAttribute('operation')?.trim() || null),
          parts: inner
            .filter((part) => isCustomElement(part) && !CONDITIONS.has(part.localName))
            .map((part) => ({ element: part.localName, attributes: attributesOf(part) })),
          conditions: [
            ...new Set(
              [element, ...inner]
                .map((part) => within.get(part))
                .filter((index): index is number => index !== undefined),
            ),
          ],
        };
      }),
  );

  // Judged on the parsed file, where comments are nodes of their own, rather than by cutting
  // comments out of the text, which a malformed comment can survive.
  const customCode: CustomCode[] = ofKind('custom-bundle').map((path) => ({
    path,
    hasCode: hasContent(parseHtml(read(path))),
  }));

  const dashboardPath = ofKind('dashboard')[0];
  let dashboard: Dashboard | null = null;
  if (dashboardPath) {
    const signatures: string[] = [];
    const cards = elementsOf(webUi(dashboardPath).document)
      .filter((element) => element.localName === 'nuxeo-card')
      .map((card) => {
        const inner = elementsOf(card).filter(isCustomElement);
        const heading = card.getAttribute('heading');
        // A card repeats another only when its whole markup is the same, attributes, columns and
        // text included, with only the spacing between them allowed to differ. Anything less would
        // risk calling two different cards one.
        const signature = markupOf(card);
        const earlier = signatures.indexOf(signature);
        signatures.push(signature);
        const provider = inner.find((element) => element.localName === 'nuxeo-page-provider');
        const pageSize = provider?.getAttribute('page-size')?.trim() ?? '';
        return {
          heading,
          elements: inner.map((element) => element.localName),
          repeatOf: earlier === -1 ? null : earlier,
          provider: provider?.getAttribute('provider')?.trim() || null,
          pageSize: /^\d+$/.test(pageSize) ? Number(pageSize) : null,
          params: provider?.getAttribute('params') ?? null,
          columns: elementsOf(card)
            .filter((element) => element.localName === 'nuxeo-data-table-column')
            .map((column) => columnOf(column, within)),
          operation:
            inner.find((element) => element.localName === 'nuxeo-operation')?.getAttribute('op') ??
            null,
          conditional: [card, ...elementsOf(card)].some((element) => within.has(element)),
        };
      });
    dashboard = { path: dashboardPath, cards };
  }

  const themes: Theme[] = ofKind('theme').map((path) => {
    const folder = path.slice(0, path.lastIndexOf('/') + 1);
    // Every `<style>`, including one inside a template, which a query would not reach.
    const css = elementsOf(webUi(path).document)
      .filter((element) => element.localName === 'style')
      .map((style) => style.textContent ?? '')
      .join('\n');
    return {
      name: folder.slice(`${UI}themes/`.length, -1),
      path,
      properties: themeProperties(css),
      assets: ofKind('theme-asset').filter((asset) => asset.startsWith(folder)),
    };
  });

  const translations: Translations[] = [];
  for (const path of ofKind('translations')) {
    const locale = /messages[-_]?([A-Za-z0-9_-]*)\.json$/.exec(path)?.[1] || 'en';
    try {
      const catalogue: unknown = JSON.parse(read(path));
      if (typeof catalogue !== 'object' || catalogue === null || Array.isArray(catalogue)) {
        problems.push({
          path,
          message: 'a translation catalogue must be an object of keys and texts',
        });
        continue;
      }
      const notText = Object.entries(catalogue).filter(([, value]) => typeof value !== 'string');
      if (notText.length > 0) {
        problems.push({
          path,
          message: `${notText.length} key(s) hold something other than text, first ${notText[0][0]}`,
        });
      }
      translations.push({ path, locale: locale.replace('_', '-'), keys: Object.keys(catalogue) });
    } catch (error) {
      problems.push({ path, message: `not valid JSON: ${(error as Error).message}` });
    }
  }

  return {
    descriptor: pkg.descriptor,
    files,
    model,
    layouts,
    searches,
    slotContributions,
    customCode,
    dashboard,
    themes,
    translations,
    elements: new Map(
      [...elements].sort(([a, countA], [b, countB]) => countB - countA || a.localeCompare(b)),
    ),
    scripts,
    conditions,
    problems,
  };
}

/** True when the document holds anything but comments and spacing. */
function hasContent(document: Document): boolean {
  const parts = [document.head, document.body].filter((part): part is HTMLElement => part !== null);
  return parts.some((part) =>
    Array.from(part.childNodes).some(
      (node) =>
        node.nodeType === node.ELEMENT_NODE ||
        (node.nodeType === node.TEXT_NODE && (node.textContent ?? '').trim() !== ''),
    ),
  );
}

/**
 * An element's markup, with runs of spacing collapsed and the spacing between tags dropped.
 * `outerHTML` serialises a template's content too, so nothing inside the element is left out.
 */
function markupOf(element: Element): string {
  return element.outerHTML.replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim();
}

/** The fields of a layout: its elements marked `role="widget"`. */
function fieldsOf(document: Document, within: ReadonlyMap<Element, number>): LayoutField[] {
  return elementsOf(document)
    .filter((element) => element.getAttribute('role') === 'widget')
    .map((element) => ({
      element: element.localName,
      binding: bindingOf(element),
      label: element.getAttribute('label') ?? childLabel(element),
      required: element.hasAttribute('required'),
      attributes: attributesOf(element),
      condition: conditionOfField(element, within),
    }));
}

/**
 * The condition a field shows under: the one it sits in, or else the first one inside it. A
 * wrapper such as `<div role="widget">` can take its binding from an element inside a
 * `nuxeo-filter` it holds, and then shows that value only while the filter passes. Any condition
 * inside the field counts, whether or not the binding comes from within it: a field left pending
 * by mistake is a decision for M2, where one shown to everyone by mistake is widened access.
 */
function conditionOfField(field: Element, within: ReadonlyMap<Element, number>): number | null {
  const own = within.get(field);
  if (own !== undefined) return own;
  for (const inner of elementsOf(field)) {
    const index = within.get(inner);
    if (index !== undefined) return index;
  }
  return null;
}

/** The elements that show what they hold only while a condition passes. */
const CONDITIONS = new Set(['nuxeo-filter', 'dom-if']);

function isCondition(element: Element): boolean {
  return (
    CONDITIONS.has(element.localName) ||
    (element.localName === 'template' && element.getAttribute('is')?.trim() === 'dom-if')
  );
}

/**
 * A file's conditions, in document order, with the innermost one each element sits in recorded
 * in `within`. Walked by hand rather than by climbing from each element, because what a template
 * holds is in its content, which does not lead back to the template.
 */
function conditionsOf(path: string, document: Document, within: Map<Element, number>): Condition[] {
  const found: Condition[] = [];
  const visit = (node: ParentNode, current: number | null): void => {
    for (const child of Array.from(node.children)) {
      let inner = current;
      if (isCondition(child)) {
        inner = found.length;
        found.push({
          path,
          index: inner,
          element: child.localName,
          attributes: attributesOf(child),
        });
      }
      // The condition itself is not inside it: only what it holds is.
      if (current !== null) within.set(child, current);
      visit(child, inner);
      const content = (child as Partial<HTMLTemplateElement>).content;
      if (child.localName === 'template' && content) visit(content, inner);
    }
  };
  visit(document, null);
  return found;
}

/**
 * A column of a list: its heading, the property it shows, and how. The property is its `field`,
 * or else the one its template binds: `item.properties.dc:modified`, or `item.title` for the title.
 */
function columnOf(column: Element, within: ReadonlyMap<Element, number>): ResultColumn {
  const inside = elementsOf(column);
  const texts = [column, ...inside].flatMap((element) => [
    ...Array.from(element.attributes, (attribute) => attribute.value),
    element.localName === 'template'
      ? ((element as HTMLTemplateElement).content?.textContent ?? '')
      : '',
  ]);
  const all = texts.join('\n');
  return {
    name: column.getAttribute('name'),
    field:
      column.getAttribute('field')?.trim() ||
      /\bitem\.properties\.([\w-]+:[\w-]+)/.exec(all)?.[1] ||
      (/\bitem\.title\b/.test(all) ? 'dc:title' : null),
    sortBy: column.getAttribute('sort-by')?.trim() || null,
    elements: inside.filter(isCustomElement).map((element) => element.localName),
    dateFormat:
      inside.find((element) => element.localName === 'nuxeo-date')?.getAttribute('format') ?? null,
    formatsDate: /\bformatDate\s*\(/.test(all),
    conditional: [column, ...inside].some((element) => within.has(element)),
  };
}

/**
 * The sorts a results layout's script offers: Studio's template writes them as
 * `this.sortOptions = [{field: 'dc:title', label: …, order: 'asc', selected: true}, …]`. They are
 * read from the script's text by pattern, and nothing is run. Whether the script is Studio's
 * template is its own construct's to say, by its shape: one that is not is customer code, pending
 * M3, and its sorts are read by the same pattern all the same.
 */
export function sortOptionsOf(script: string): SortOption[] {
  const start = script.search(/\bsortOptions\s*=\s*\[/);
  if (start === -1) return [];
  const list = script.slice(
    start,
    script.indexOf('];', start) === -1 ? undefined : script.indexOf('];', start),
  );
  return [...list.matchAll(/\{\s*field\s*:\s*(['"])([^'"]+)\1([^{}]*)\}/g)].flatMap((match) => {
    const order = /\border\s*:\s*(['"])(asc|desc)\1/.exec(match[3])?.[2];
    return order === 'asc' || order === 'desc'
      ? [{ field: match[2], order, selected: /\bselected\s*:\s*true\b/.test(match[3]) }]
      : [];
  });
}

/**
 * The property a field binds, read from its attributes and text and those of what it holds: a
 * view layout writes `[[document.properties.cl:number]]` in a child, an edit layout
 * `value="{{document.properties.cl:number}}"`, a search form `value="{{params.cl_number}}"`.
 */
function bindingOf(field: Element): string | null {
  const texts = [field, ...elementsOf(field)].flatMap((element) =>
    Array.from(element.attributes).map((attribute) => attribute.value),
  );
  texts.push(field.textContent ?? '');
  const all = texts.join('\n');
  return (
    /document\.properties\.([\w-]+:[\w-]+)/.exec(all)?.[1] ??
    /\bparams\.([\w:-]+)/.exec(all)?.[1] ??
    null
  );
}

function moduleId(document: Document, path: string): string {
  return (
    document.querySelector('dom-module')?.getAttribute('id') ??
    path.slice(path.lastIndexOf('/') + 1, -'.html'.length)
  );
}

/** A JSDoc tag in the layout's script, such as `@doctype Claim` or `@search claims`. */
function annotation(text: string, tag: string): string | null {
  return new RegExp(`@${tag}\\s+([\\w-]+)`).exec(text)?.[1] ?? null;
}
