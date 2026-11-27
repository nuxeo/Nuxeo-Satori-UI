/**
 * What a Studio package holds, file by file and construct by construct.
 *
 * This is the ground truth the migration harness's first check holds every report against
 * (docs/business-apps/studio-migration.md, section 6, check 1): nothing in a package may be
 * dropped silently. So every file gets a kind, and one that matches no known kind is listed as
 * `unrecognised` rather than skipped; a file that cannot be read is listed in `problems` rather
 * than ending the run.
 */
import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import {
  attributesOf,
  childLabel,
  elementsOf,
  isCustomElement,
  parseHtml,
  parseXml,
} from './markup';
import { elementModules, readCustomElement, type CustomElement } from './elements';
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
  | 'task-layout'
  | 'layout-block'
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
  /** The first of `conditions`, by its place among its file's conditions, from 0; `null` for none. */
  readonly condition: number | null;
  /**
   * The conditions it shows its property under: the innermost one around each place in a
   * condition that names it, in an attribute or text, reduced to the one all those places sit in
   * when one place sits there alone. Places side by side give them all. A field that binds nothing keeps every
   * condition it sits in or holds.
   */
  readonly conditions: readonly number[];
  /**
   * Set when which of its places shows the value, and to whom, cannot be told from the markup:
   * it names its property both in a condition and outside every one, and the place outside may
   * only read it, as `hidden$="[[!…]]"` does (`outside`); or it holds a condition whose content
   * binds something or holds an element, and may show the value by other means than naming it,
   * as a widget's `xpath` does (`other`). `conditions` then holds every condition it sits in or
   * holds, and whether everyone sees it is a person's call.
   */
  readonly placesUnclear: { readonly reason: 'outside' | 'other'; readonly at: number } | null;
  /**
   * True when it binds its property or variable two ways, in a `{{…}}` binding, as an input
   * does: Web UI then writes what is entered back. One bound in `[[…]]` or text alone only
   * shows it, as a label beside a value or `nuxeo-date` does.
   */
  readonly edits: boolean;
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
  /** The condition it sits in, by its place among its file's conditions; `null` for none. */
  readonly parent: number | null;
  /**
   * True when a `[[user]]` binding in its file reaches the signed-in user. Web UI stamps a slot
   * contribution with a shared model that holds the user (`nuxeo-app.js`, `setSharedModel`). A
   * document layout is given `{ document }` alone (`nuxeo-layout`), and `nuxeo-home` is stamped
   * with nothing, so there `user` is the host's own property, set only by what writes it: a
   * `<nuxeo-connection user="{{user}}">`, whose `user` notifies. Declaring the property sets nothing.
   */
  readonly userInScope: boolean;
  /**
   * False in a task layout, where Web UI's document is the task's first target as its task page
   * fetches the task (`nuxeo-app.js`, `fetch-task: targetDocumentIds`): the whole document, with
   * its type, state, facets and properties, but none of its permissions, which no enricher asks
   * for. A permission test there never passes. True, or left out, elsewhere.
   */
  readonly permissionsInScope?: boolean;
  /**
   * What a person decided of the rule proposed for it, taken from `decisions.json`
   * (`decisions.ts`), for a condition in a known JavaScript pattern: accepted, it decides as its
   * rule wherever the rule is written; rejected, it is reported. Never set by reading a package:
   * `withVerdicts` sets it, on a copy, for the converter and the checks alike.
   */
  readonly verdict?: { readonly accepted: boolean; readonly rule: unknown };
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
  /**
   * True when it sits in a condition its table does not, or its template holds one: it then shows
   * only to some of those who see the list.
   */
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

/**
 * A workflow task layout: the form of one step of a workflow, which Web UI loads from
 * `ui/workflow/<workflow>/nuxeo-<step>-layout.html`, both names in lower case
 * (`nuxeo-document-task.js`, `_updateTaskLayout`). Its fields bind the task's variables as
 * `task.variables.<name>`.
 */
export interface TaskLayout {
  readonly path: string;
  /** The `dom-module` id. */
  readonly element: string;
  /** The workflow's folder: its model's name in lower case, as Web UI looks it up. */
  readonly workflow: string;
  /** The step's node id in lower case, from the file's name. */
  readonly step: string;
  /** From the layout's `@task` annotation: the step's variable schema, as Studio writes it. */
  readonly variables: string | null;
  /** Each binds `var:<name>` for `task.variables.<name>`, or a document property. */
  readonly fields: readonly LayoutField[];
}

/**
 * A layout block: a Polymer element of the package that other layouts use by its name, as Studio
 * Designer's layout blocks are. Recognised by what it is, a `dom-module` with
 * `Nuxeo.LayoutBehavior` in a Web UI file of no other kind, because no package in hand shows the
 * folder Studio writes blocks to.
 */
export interface LayoutBlock {
  readonly path: string;
  /** The `dom-module` id: the element a layout uses it by. */
  readonly element: string;
  readonly fields: readonly LayoutField[];
}

/** A layout block used in a file: an element named as a block of the package is. */
export interface BlockUse {
  /** The file it is used in. */
  readonly path: string;
  /** Its place among its file's block uses, from 0. */
  readonly index: number;
  readonly element: string;
  /** The block's file. */
  readonly block: string;
  /** How many of its file's fields come before it, in document order: where its card goes. */
  readonly after: number;
  /** The condition it sits in, innermost, by its place among its file's conditions; or none. */
  readonly conditions: readonly number[];
  /** True when it is given the page's document, as `document="[[document]]"` or `{{document}}`. */
  readonly document: boolean;
  readonly attributes: Readonly<Record<string, string>>;
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
  /**
   * The conditions around what it becomes, by their place among the file's conditions: its
   * operation buttons and menu icons, an action's or an entry's, or a left-menu page's search
   * form. With none of them, every condition it holds.
   */
  readonly conditions: readonly number[];
  /** The layout blocks it holds, by their place among its file's block uses. */
  readonly uses: readonly number[];
  /** Set by `disabled`: Web UI's slot then shows nothing of it (`nuxeo-slots.js`, `_render`). */
  readonly disabled: boolean;
  /**
   * Its `priority`, as Polymer reads a Number attribute, 0 when left out or not a number: a later
   * contribution of the same name wins at the same or a higher one.
   */
  readonly priority: number;
  /** Its `order` as Polymer reads it, which may not be whole; `null` when left out or not a number. */
  readonly orderValue: number | null;
  /** False when it holds no template: it then only changes another of its name, as `disabled` does. */
  readonly hasTemplate: boolean;
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
  /**
   * The conditions around its page provider and its table, both of which its list needs, by their
   * place among the dashboard's conditions; with neither, every condition it sits in or holds.
   */
  readonly conditions: readonly number[];
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
  /**
   * True when it holds more than comments, its custom elements (`customElements`) and its slot
   * contributions, each of which is a construct of its own: a script outside every element, a
   * style, an import of another file.
   */
  readonly hasOtherCode: boolean;
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
  readonly taskLayouts: readonly TaskLayout[];
  readonly blocks: readonly LayoutBlock[];
  /** Every use of a layout block, in any Web UI file of the package. */
  readonly blockUses: readonly BlockUse[];
  readonly searches: readonly SearchLayout[];
  readonly slotContributions: readonly SlotContribution[];
  readonly customCode: readonly CustomCode[];
  /**
   * The custom elements the custom bundle defines (`elements.ts`), which the code track of M3
   * turns into Layer 2 plugins. What each holds is its own: its scripts, conditions and the
   * elements its template uses are not among this inventory's `scripts`, `conditions` and
   * `elements`, which are the rest of the package's.
   */
  readonly customElements: readonly CustomElement[];
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
  [/^web\/nuxeo\.war\/ui\/workflow\/[^/]+\/nuxeo-[^/]+-layout\.html$/, 'task-layout'],
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

/**
 * The SHA-256 of what a custom element can reach in the package: its definition, `own`; the code of
 * its custom bundle outside its elements and slot contributions, `bundle`; and each file of the
 * package either names, with its bytes, or "absent" for one the package does not hold, such as
 * Web UI's own. Read once, not followed further.
 */
function reachOf(
  element: Pick<CustomElement, 'sha256'>,
  bundle: { readonly markup: string; readonly named: readonly string[] } | undefined,
  own: readonly string[],
  file: (path: string) => Buffer | undefined,
): string {
  const hash = createHash('sha256').update(`definition\u0000${element.sha256}\n`);
  hash.update(`bundle\u0000${bundle?.markup ?? ''}\n`);
  for (const path of [...new Set([...own, ...(bundle?.named ?? [])])].sort()) {
    const bytes = file(path);
    hash.update(
      `${path}\u0000${bytes ? createHash('sha256').update(bytes).digest('hex') : 'absent'}\n`,
    );
  }
  return hash.digest('hex');
}

/** The files of the package the elements given name in a `src` or an `href`, from `path`'s folder. */
function namedFiles(path: string, elements: readonly Element[]): string[] {
  const folder = posix.dirname(path);
  return elements.flatMap((element) =>
    ['src', 'href'].flatMap((attribute) => {
      const value = element.getAttribute(attribute)?.trim() ?? '';
      // A URL of another origin, a fragment or a data URL is no file of the package.
      if (value === '' || /^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value)) return [];
      return [posix.normalize(posix.join(folder, value.split(/[?#]/)[0] ?? ''))];
    }),
  );
}

export function inventory(pkg: StudioPackage): Inventory {
  // Every path asked for comes from the bundle's own listing, so it is always there.
  const read = (path: string): string =>
    (pkg.bundleFiles.get(path) ?? Buffer.alloc(0)).toString('utf8');
  // A layout block is known by what it is, not by where it sits: a Web UI file of no other kind
  // that defines an element with Web UI's layout behaviour. The first file to define an element
  // is its block; a second one defining it stays of no known kind, and is reported.
  const blockPaths = new Map<string, string>();
  for (const [path] of pkg.bundleFiles) {
    if (classify(path, 'bundle', pkg.bundlePath) !== 'unrecognised') continue;
    if (!path.startsWith(UI) || !path.endsWith('.html')) continue;
    const element = blockElement(read(path));
    if (element !== null && !blockPaths.has(element)) blockPaths.set(element, path);
  }
  const blockFiles = new Set(blockPaths.values());
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
      kind: blockFiles.has(path)
        ? ('layout-block' as const)
        : classify(path, 'bundle', pkg.bundlePath),
      bytes: data.length,
    })),
  ];

  const problems: InventoryProblem[] = [];
  const elements = new Map<string, number>();
  const ofKind = (kind: FileKind): string[] =>
    files
      .filter((file) => file.location === 'bundle' && file.kind === kind)
      .map((file) => file.path);

  const scripts: ScriptUse[] = [];
  const conditions: Condition[] = [];
  /** The condition each element of a file sits in, for the files read so far. */
  const within = new Map<Element, number>();
  /** Each condition element's own place among its file's conditions. */
  const conditionAt = new Map<Element, number>();
  /** Where conditions sit in the file at `path`, for what is shown under them. */
  const placesIn = (path: string): Places => ({
    within,
    conditionAt,
    parentOf: (index) =>
      conditions.find((condition) => condition.path === path && condition.index === index)
        ?.parent ?? null,
  });
  /**
   * Parses a Web UI file, counts its custom elements, records its scripts and conditions, and
   * hands its document on.
   */
  const blockUses: BlockUse[] = [];
  /** Each block use's element, for the slot contribution that holds it. */
  const useAt = new Map<Element, BlockUse>();
  const customElements: CustomElement[] = [];
  /** The package's files each custom element names in a `src` or an `href`, for its SHA-256. */
  const named = new Map<CustomElement, readonly string[]>();
  /** The custom elements each Web UI file uses, by name, for each element's `uses`. */
  const usedIn = new Map<string, Set<string>>();
  const webUi = (
    path: string,
    options: { readonly task?: boolean; readonly customBundle?: boolean } = {},
  ): { document: Document; text: string } => {
    const text = read(path);
    const document = parseHtml(text);
    // A custom element's definition is the element's: read whole, then taken out of the file, so
    // that its scripts, conditions and elements are not counted as the rest of the package's.
    if (options.customBundle)
      for (const module of elementModules(document)) {
        const element = readCustomElement(
          path,
          customElements.filter((candidate) => candidate.path === path).length,
          module,
        );
        customElements.push(element);
        named.set(element, namedFiles(path, [module, ...elementsOf(module)]));
        module.remove();
      }
    conditions.push(
      ...conditionsOf(path, document, within, conditionAt).map((condition) => ({
        ...condition,
        userInScope: path.endsWith('-bundle.html') || writesUser(document),
        ...(options.task ? { permissionsInScope: false } : {}),
      })),
    );
    let index = 0;
    let fieldsBefore = 0;
    for (const element of elementsOf(document)) {
      if (isCustomElement(element) && !WRAPPERS.has(element.localName)) {
        elements.set(element.localName, (elements.get(element.localName) ?? 0) + 1);
        usedIn.set(element.localName, (usedIn.get(element.localName) ?? new Set()).add(path));
      }
      if (element.getAttribute('role') === 'widget') fieldsBefore++;
      const block = blockPaths.get(element.localName);
      if (block !== undefined) {
        const around = within.get(element);
        const use: BlockUse = {
          path,
          index: blockUses.filter((other) => other.path === path).length,
          element: element.localName,
          block,
          after: fieldsBefore,
          conditions: around === undefined ? [] : [around],
          document: /^(?:\[\[|\{\{)\s*document\s*(?:\]\]|\}\})$/.test(
            element.getAttribute('document')?.trim() ?? '',
          ),
          attributes: attributesOf(element),
        };
        blockUses.push(use);
        useAt.set(element, use);
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
      fields: fieldsOf(document, placesIn(path)),
    };
  });

  const taskLayouts: TaskLayout[] = ofKind('task-layout').map((path) => {
    const { document, text } = webUi(path, { task: true });
    const folder = path.slice(0, path.lastIndexOf('/'));
    return {
      path,
      element: moduleId(document, path),
      workflow: folder.slice(folder.lastIndexOf('/') + 1),
      step: /\/nuxeo-([^/]+)-layout\.html$/.exec(path)?.[1] ?? '',
      variables: annotation(text, 'task'),
      fields: fieldsOf(document, placesIn(path), { task: true }),
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
        fields: fieldsOf(document, placesIn(path)),
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

  // The custom bundle, which Studio's own bundle imports first, may hold contributions too: one
  // that disables or outranks a button of the bundle is where a project's hand-written changes go.
  const customBundles = new Set(ofKind('custom-bundle'));
  const slotContributions: SlotContribution[] = [
    ...ofKind('custom-bundle'),
    ...ofKind('slot-contributions'),
  ].flatMap((path) =>
    elementsOf(webUi(path, { customBundle: customBundles.has(path) }).document)
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
          // What it becomes is its operation button or its menu icon, for a left-menu page the
          // search form it opens, for a tab its page item, and for a tab's page the element that
          // page is, named as the item: the conditions around that, not around some other part
          // of it, such as a tooltip.
          conditions: conditionsAround(
            [element, ...inner],
            element.getAttribute('slot') === 'DOCUMENT_VIEWS_PAGES'
              ? inner
                  .filter((part) => isCustomElement(part) && part.hasAttribute('name'))
                  .map((part) => part.localName)
              : (KEY_PARTS.get(element.getAttribute('slot') ?? '') ?? [
                  'nuxeo-operation-button',
                  'nuxeo-menu-icon',
                ]),
            within,
          ),
          uses: [element, ...inner]
            .map((part) => useAt.get(part)?.index)
            .filter((index): index is number => index !== undefined),
          disabled: element.hasAttribute('disabled'),
          priority: polymerNumber(element.getAttribute('priority')) ?? 0,
          orderValue: polymerNumber(element.getAttribute('order')),
          hasTemplate: Array.from(element.children).some((child) => child.localName === 'template'),
        };
      }),
  );

  // Judged on the parsed file, where comments are nodes of their own, rather than by cutting
  // comments out of the text, which a malformed comment can survive.
  /** Each custom bundle's code outside its elements and slot contributions, as markup. */
  const bundleCode = new Map<string, { markup: string; named: readonly string[] }>();
  const customCode: CustomCode[] = ofKind('custom-bundle').map((path) => {
    const rest = parseHtml(read(path));
    for (const module of elementModules(rest)) module.remove();
    for (const contribution of elementsOf(rest).filter(
      (element) => element.localName === 'nuxeo-slot-content',
    ))
      contribution.remove();
    bundleCode.set(path, {
      markup: rest.documentElement.outerHTML,
      named: namedFiles(path, elementsOf(rest)),
    });
    return {
      path,
      hasCode: hasContent(parseHtml(read(path))),
      hasOtherCode: hasContent(rest),
    };
  });

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
          // Its list shows where its page provider and its table both do.
          conditions: conditionsAround(
            [card, ...elementsOf(card)],
            ['nuxeo-page-provider', 'nuxeo-data-table'],
            within,
          ),
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

  // Read last, so that the conditions and scripts of the files above keep their order.
  const blocks: LayoutBlock[] = ofKind('layout-block').map((path) => {
    const { document } = webUi(path);
    return {
      path,
      element: moduleId(document, path),
      fields: fieldsOf(document, placesIn(path)),
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
    taskLayouts,
    blocks,
    blockUses,
    searches,
    slotContributions,
    customCode,
    // Where each is used: the package's files, and the templates of its other elements.
    customElements: customElements.map((element) => ({
      ...element,
      // What it can reach in the package: its definition, the custom bundle's code outside its
      // elements, where a behaviour or a mixin it uses is defined, and the package's files either
      // names in a `src` or an `href`. A change to any of them makes it another element, whose
      // plugin is decided again (its identity, `constructs.ts`) and restamped (check 9).
      sha256: reachOf(element, bundleCode.get(element.path), named.get(element) ?? [], (file) =>
        pkg.bundleFiles.get(file),
      ),
      uses: [
        ...(usedIn.get(element.name) ?? []),
        ...customElements
          .filter((other) => other !== element && other.elements.includes(element.name))
          .map((other) => `${other.path}, in ${other.name}`),
      ],
    })),
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

/** Where a file's conditions sit: around which elements, each one's own place, and its parent. */
interface Places {
  readonly within: ReadonlyMap<Element, number>;
  readonly conditionAt: ReadonlyMap<Element, number>;
  readonly parentOf: (index: number) => number | null;
}

/**
 * The fields of a layout: its elements marked `role="widget"`. In a task layout a field binds a
 * variable of the task, `task.variables.<name>`, which is `var:<name>`, before any property.
 */
function fieldsOf(
  document: Document,
  places: Places,
  options: { readonly task?: boolean } = {},
): LayoutField[] {
  return elementsOf(document)
    .filter((element) => element.getAttribute('role') === 'widget')
    .map((element) => {
      const binding = bindingOf(element, options.task === true);
      const shown = binding === null ? [] : placesShowing(element, binding, places);
      const inside = shown.filter((place): place is number => place !== null);
      const unclear = unclearPlaces(element, shown, inside, places);
      // A field that binds nothing, or whose places are unclear, keeps every condition it sits in
      // or holds: it is reported.
      const conditions =
        shown.length > 0 && unclear === null
          ? shownUnder(inside, places.parentOf)
          : heldConditions(element, places);
      return {
        element: element.localName,
        binding,
        label: element.getAttribute('label') ?? childLabel(element),
        required: element.hasAttribute('required'),
        attributes: attributesOf(element),
        condition: conditions[0] ?? null,
        conditions,
        placesUnclear: unclear,
        edits: binding !== null && editsBinding(element, binding),
      };
    });
}

/** Web UI's elements that show a value and change none, whatever binds it. */
const DISPLAY_ELEMENTS: ReadonlySet<string> = new Set([
  'nuxeo-date',
  'nuxeo-user-tag',
  'nuxeo-tag',
]);
/** The native elements a person types or chooses in. */
const NATIVE_INPUTS: ReadonlySet<string> = new Set(['input', 'textarea', 'select']);

/**
 * True when an element, or what it holds, edits `binding`: an input, not read-only nor disabled,
 * that binds exactly that path two ways, `{{path}}` or `{{path::event}}`. Polymer binds a computed
 * or negated `{{…}}` one way, and an element that only shows a value writes nothing back.
 */
function editsBinding(field: Element, binding: string): boolean {
  const exact = bindingPath(binding);
  return [field, ...elementsOf(field)].some((element) => {
    const name = element.localName;
    const input = name.includes('-') ? !DISPLAY_ELEMENTS.has(name) : NATIVE_INPUTS.has(name);
    if (!input || element.hasAttribute('readonly') || element.hasAttribute('disabled'))
      return false;
    return Array.from(element.attributes).some((attribute) =>
      [...attribute.value.matchAll(/\{\{([^}]*)\}\}/g)].some(([, inner]) => exact.test(inner)),
    );
  });
}

/** A binding's whole content when it names `binding` alone: the path, then any `::event`. */
function bindingPath(binding: string): RegExp {
  const variable = binding.startsWith(VARIABLE) ? binding.slice(VARIABLE.length) : null;
  const escaped = (variable ?? binding).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const path =
    variable !== null
      ? `task\\.variables\\.${escaped}`
      : `(?:document\\.properties|params)\\.${escaped}`;
  return new RegExp(`^\\s*${path}(?:::[\\w-]+)?\\s*$`);
}

/** What names a binding in Web UI's markup: `task.variables.<name>`, or a property or parameter. */
function bindingPattern(binding: string): RegExp {
  const variable = binding.startsWith(VARIABLE) ? binding.slice(VARIABLE.length) : null;
  const escaped = (variable ?? binding).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return variable !== null
    ? new RegExp(`\\btask\\.variables\\.${escaped}(?![\\w-])`)
    : new RegExp(`(?:document\\.properties|\\bparams)\\.${escaped}(?![\\w:-])`);
}

/**
 * A Number attribute as Polymer deserialises it, `Number(value)`: `NaN` and `Infinity` included,
 * as Web UI compares them; `null` when left out, which the slot's default, 0, stands for.
 */
function polymerNumber(text: string | null): number | null {
  if (text === null) return null;
  return Number(text);
}

/**
 * Why a field's places say nothing sure about who sees its value, or `null`: see
 * `LayoutField.placesUnclear`. A condition inside the field around static text alone, a hint,
 * hides no value.
 */
function unclearPlaces(
  field: Element,
  shown: readonly (number | null)[],
  inside: readonly number[],
  places: Places,
): LayoutField['placesUnclear'] {
  if (shown.includes(null) && inside.length > 0) return { reason: 'outside', at: inside[0] };
  const around = new Set<number>();
  for (const index of inside)
    for (let at: number | null = index; at !== null && !around.has(at); at = places.parentOf(at))
      around.add(at);
  for (const element of elementsOf(field)) {
    const index = places.conditionAt.get(element);
    if (index === undefined || around.has(index) || !holdsData(element)) continue;
    return { reason: 'other', at: index };
  }
  return null;
}

/** True when a condition's content binds something, or holds an element of its own. */
function holdsData(condition: Element): boolean {
  const inner = elementsOf(condition);
  if (inner.some((element) => isCustomElement(element) && !isCondition(element))) return true;
  const texts = [
    ...inner.flatMap((element) => Array.from(element.attributes, (attribute) => attribute.value)),
    condition.textContent ?? '',
    ...[condition, ...inner]
      .filter((element) => element.localName === 'template')
      .map((element) => (element as HTMLTemplateElement).content?.textContent ?? ''),
  ];
  return texts.some((text) => /\[\[|\{\{/.test(text));
}

/** Every condition an element sits in or holds. */
function heldConditions(element: Element, places: Places): number[] {
  return [
    ...new Set(
      [element, ...elementsOf(element)]
        .map((inner) => places.within.get(inner))
        .filter((index): index is number => index !== undefined),
    ),
  ];
}

/**
 * The innermost condition around each place a field shows its property, `null` for none: an
 * attribute that binds it, or text that does, including text a template holds, which sits in that
 * template's condition, or in what the template sits in.
 */
function placesShowing(field: Element, binding: string, places: Places): (number | null)[] {
  const pattern = bindingPattern(binding);
  const found: (number | null)[] = [];
  const around = (element: Element): number | null => places.within.get(element) ?? null;
  const binds = (element: Element): boolean =>
    Array.from(element.attributes).some((attribute) => pattern.test(attribute.value));
  const visit = (node: Element | DocumentFragment, host: Element): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) {
        if (pattern.test(child.textContent ?? ''))
          found.push(places.conditionAt.get(host) ?? around(host));
        continue;
      }
      if (child.nodeType !== 1) continue;
      const element = child as Element;
      if (binds(element)) found.push(around(element));
      visit(element, element);
      const content = (element as Partial<HTMLTemplateElement>).content;
      if (element.localName === 'template' && content) visit(content, element);
    }
  };
  if (binds(field)) found.push(around(field));
  visit(field, field);
  return found;
}

/**
 * The conditions a field shows its property under, from the places in a condition where it names
 * it: it shows while any of those places does. A place every other sits inside gives the guard
 * alone. Otherwise the places sit side by side, and all are given, for the guard to report. None
 * gives none: the field shows to everyone.
 */
function shownUnder(
  shown: readonly number[],
  parentOf: (index: number) => number | null,
): number[] {
  const indexes = [...new Set(shown)];
  const chain = (index: number): number[] => {
    const found: number[] = [];
    for (let at: number | null = index; at !== null && !found.includes(at); at = parentOf(at))
      found.push(at);
    return found;
  };
  const outer = indexes.find((candidate) =>
    indexes.every((other) => chain(other).includes(candidate)),
  );
  return outer === undefined ? indexes : [outer];
}

/**
 * The conditions around the elements of `names` among `elements`, all of which must show; with
 * none of them, every condition the elements sit in or hold.
 */
function conditionsAround(
  elements: readonly Element[],
  names: readonly string[],
  within: ReadonlyMap<Element, number>,
): number[] {
  const keys = elements.filter((element) => names.includes(element.localName));
  return [
    ...new Set(
      (keys.length > 0 ? keys : elements)
        .map((element) => within.get(element))
        .filter((index): index is number => index !== undefined),
    ),
  ];
}

/** True when the file writes the host's `user`: a `<nuxeo-connection user="{{user}}">`. */
function writesUser(document: Document): boolean {
  return elementsOf(document).some(
    (element) =>
      element.localName === 'nuxeo-connection' &&
      /^\{\{\s*user\s*\}\}$/.test(element.getAttribute('user') ?? ''),
  );
}

/** The elements that show what they hold only while a condition passes. */
const CONDITIONS = new Set(['nuxeo-filter', 'dom-if']);

export function isCondition(element: Element): boolean {
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
function conditionsOf(
  path: string,
  document: Document,
  within: Map<Element, number>,
  conditionAt: Map<Element, number>,
): Omit<Condition, 'userInScope'>[] {
  const found: Omit<Condition, 'userInScope'>[] = [];
  const visit = (node: ParentNode, current: number | null): void => {
    for (const child of Array.from(node.children)) {
      let inner = current;
      if (isCondition(child)) {
        inner = found.length;
        conditionAt.set(child, inner);
        found.push({
          path,
          index: inner,
          element: child.localName,
          attributes: attributesOf(child),
          parent: current,
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
  const table = column.closest('nuxeo-data-table');
  const base = table ? within.get(table) : undefined;
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
    // Relative to its table: a column of a list shown only under a condition is not hidden on its
    // own, and the list's own guard covers it.
    conditional: [column, ...inside].some((element) => within.get(element) !== base),
  };
}

/**
 * The sorts a results layout's script offers: Studio's template writes them as
 * `this.sortOptions = [{field: 'dc:title', label: …, order: 'asc', selected: true}, …]`. They are
 * read from the script's text by pattern, and nothing is run. Whether the script is Studio's
 * template is its own construct's to say, by its shape: one that is not is customer code, reported,
 * and its sorts are read by the same pattern all the same.
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
function bindingOf(field: Element, task: boolean): string | null {
  const elements = [field, ...elementsOf(field)];
  const texts = elements.flatMap((element) =>
    Array.from(element.attributes).map((attribute) => attribute.value),
  );
  texts.push(field.textContent ?? '');
  // `textContent` leaves out what a template holds, such as the value a filter inside shows.
  for (const element of elements)
    if (element.localName === 'template')
      texts.push((element as HTMLTemplateElement).content?.textContent ?? '');
  const all = texts.join('\n');
  const variable = task ? /\btask\.variables\.([A-Za-z_][\w-]*)/.exec(all)?.[1] : undefined;
  if (variable !== undefined) return `${VARIABLE}${variable}`;
  return (
    /document\.properties\.([\w-]+:[\w-]+)/.exec(all)?.[1] ??
    /\bparams\.([\w:-]+)/.exec(all)?.[1] ??
    null
  );
}

/** The prefix a task form names a variable of its step or workflow by (app-definition-v2.md, section 6). */
export const VARIABLE = 'var:';

/**
 * The element a file defines when it is a layout block: one `dom-module`, with a custom element's
 * name, whose script gives it Web UI's layout behaviour, as Studio Designer's templates do.
 */
function blockElement(text: string): string | null {
  const document = parseHtml(text);
  const modules = Array.from(document.querySelectorAll('dom-module'));
  if (modules.length !== 1) return null;
  const id = modules[0].getAttribute('id')?.trim() ?? '';
  if (!/^[a-z][a-z0-9._-]*-[a-z0-9._-]*$/.test(id)) return null;
  const scripts = elementsOf(document).filter((element) => element.localName === 'script');
  return scripts.some((script) => /\bNuxeo\.LayoutBehavior\b/.test(script.textContent ?? ''))
    ? id
    : null;
}

/** The parts of a contribution, by its slot, whose conditions are what it becomes's. */
const KEY_PARTS: ReadonlyMap<string, readonly string[]> = new Map([
  ['DRAWER_PAGES', ['nuxeo-search-form']],
  ['DOCUMENT_VIEWS_ITEMS', ['nuxeo-page-item']],
]);

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
