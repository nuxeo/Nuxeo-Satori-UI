/**
 * What a Studio package holds, file by file and construct by construct.
 *
 * This is the ground truth the migration harness's first check holds every report against
 * (docs/business-apps/studio-migration.md, section 6, check 1): nothing in a package may be
 * dropped silently. So every file gets a kind, and one that matches no known kind is listed as
 * `unrecognised` rather than skipped; a file that cannot be read is listed in `problems` rather
 * than ending the run.
 */
import { childLabel, elementsOf, isCustomElement, parseHtml, parseXml } from './markup';
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
  /** The result views it offers: `nuxeo-data-table`, `nuxeo-data-grid`, `nuxeo-justified-grid`. */
  readonly views: readonly string[];
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
}

export interface DashboardCard {
  readonly heading: string | null;
  readonly elements: readonly string[];
  /** The index of an earlier card with the same heading and content, which this one repeats. */
  readonly repeatOf: number | null;
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

const PACKAGE_KINDS: Readonly<Record<string, FileKind>> = {
  'package.xml': 'package-descriptor',
  'install.xml': 'package-install',
  'studio-registries.json': 'package-registries',
};

const RESULT_VIEWS = ['nuxeo-data-table', 'nuxeo-data-grid', 'nuxeo-justified-grid'];
const WRAPPERS = new Set(['dom-module', 'custom-style']);

export function classify(
  path: string,
  location: 'package' | 'bundle',
  bundlePath: string,
): FileKind {
  if (location === 'package') {
    if (path === bundlePath) return 'bundle';
    return PACKAGE_KINDS[path] ?? 'unrecognised';
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

  /** Parses a Web UI file, counts its custom elements, and hands its document on. */
  const webUi = (path: string): { document: Document; text: string } => {
    const text = read(path);
    const document = parseHtml(text);
    for (const element of elementsOf(document)) {
      if (isCustomElement(element) && !WRAPPERS.has(element.localName)) {
        elements.set(element.localName, (elements.get(element.localName) ?? 0) + 1);
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
      fields: fieldsOf(document),
    };
  });

  const parsedSearches = [...ofKind('search-form'), ...ofKind('search-results')]
    .sort()
    .map((path) => {
      const { document, text } = webUi(path);
      const all = elementsOf(document);
      return {
        path,
        element: moduleId(document, path),
        provider: annotation(text, 'search'),
        part: path.endsWith('-search-form.html') ? ('form' as const) : ('results' as const),
        fields: fieldsOf(document),
        columns: all.filter((element) => element.localName === 'nuxeo-data-table-column').length,
        views: RESULT_VIEWS.filter((view) => all.some((element) => element.localName === view)),
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
        return {
          path,
          name: element.getAttribute('name') ?? '',
          slot: element.getAttribute('slot') ?? '',
          order: order !== null && /^-?\d+$/.test(order.trim()) ? Number(order) : null,
          elements: elementsOf(element)
            .filter(isCustomElement)
            .map((inner) => inner.localName),
          operations: elementsOf(element)
            .filter((inner) => inner.localName === 'nuxeo-operation-button')
            .map((button) => button.getAttribute('operation')?.trim() || null),
        };
      }),
  );

  const customCode: CustomCode[] = ofKind('custom-bundle').map((path) => ({
    path,
    hasCode:
      read(path)
        .replace(/<!--[\s\S]*?-->/g, '')
        .trim().length > 0,
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
        // A card repeats another when it shows the same heading over the same content: the same
        // elements reading the same page providers.
        const signature = JSON.stringify([
          heading,
          inner.map((element) => [element.localName, element.getAttribute('provider')]),
        ]);
        const earlier = signatures.indexOf(signature);
        signatures.push(signature);
        return {
          heading,
          elements: inner.map((element) => element.localName),
          repeatOf: earlier === -1 ? null : earlier,
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
    problems,
  };
}

/** The fields of a layout: its elements marked `role="widget"`. */
function fieldsOf(document: Document): LayoutField[] {
  return elementsOf(document)
    .filter((element) => element.getAttribute('role') === 'widget')
    .map((element) => ({
      element: element.localName,
      binding: bindingOf(element),
      label: element.getAttribute('label') ?? childLabel(element),
      required: element.hasAttribute('required'),
    }));
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
