/**
 * The constructs of a package: everything the migration must account for, one by one.
 *
 * Check 1 of the harness (docs/business-apps/studio-migration.md, section 6) holds a conversion's
 * report against this list: every construct listed once, with an outcome. A file that holds
 * constructs is accounted for through them; a file that holds none is a construct of its own, so
 * no file can drop out of the count. The list comes from the inventory, which parses the package;
 * `second-count.ts` counts the same constructs from the raw text, so that a parser which misses
 * something is caught by the disagreement.
 */
import type { FileKind, Inventory } from './inventory';

export type ConstructKind =
  | 'file'
  | 'layout'
  | 'layout-field'
  | 'search'
  | 'search-field'
  | 'search-column'
  | 'slot-contribution'
  | 'custom-code'
  | 'script'
  | 'dashboard-card'
  | 'theme-property'
  | 'translation';

/** The kinds both counts cover. A file of one of these kinds holds them. */
export const COUNTED_KINDS: readonly ConstructKind[] = [
  'layout-field',
  'search-field',
  'search-column',
  'slot-contribution',
  'script',
  'dashboard-card',
  'theme-property',
  'translation',
];

export interface Construct {
  /** Unique within the package, and the same every time the package is read. */
  readonly id: string;
  readonly kind: ConstructKind;
  /** The file it is in, as the inventory names it. */
  readonly file: string;
  /** What it is, for people. */
  readonly label: string;
}

/** Files whose content is read construct by construct. A file of another kind is one construct. */
const CONTAINERS: ReadonlySet<FileKind> = new Set<FileKind>([
  'document-layout',
  'search-form',
  'search-results',
  'slot-contributions',
  'custom-bundle',
  'dashboard',
  'theme',
  'translations',
]);

export function constructsOf(inventory: Inventory): Construct[] {
  const constructs: Construct[] = [];
  const add = (kind: ConstructKind, file: string, key: string, label: string): void => {
    constructs.push({ id: `${kind}:${file}#${key}`, kind, file, label });
  };

  for (const layout of inventory.layouts) {
    add(
      'layout',
      layout.path,
      'layout',
      `the ${layout.mode} layout of ${layout.docType ?? 'an unnamed type'}`,
    );
    layout.fields.forEach((field, index) =>
      add(
        'layout-field',
        layout.path,
        String(index + 1),
        fieldLabel(field.binding, field.label, field.element),
      ),
    );
  }
  for (const search of inventory.searches) {
    add(
      'search',
      search.path,
      'search',
      `the search ${search.part} of ${search.provider ?? 'an unnamed provider'}`,
    );
    search.fields.forEach((field, index) =>
      add(
        'search-field',
        search.path,
        String(index + 1),
        fieldLabel(field.binding, field.label, field.element),
      ),
    );
    for (let index = 0; index < search.columns; index++) {
      add('search-column', search.path, String(index + 1), `column ${index + 1}`);
    }
  }
  for (const [path, contributions] of groupBy(inventory.slotContributions, (c) => c.path)) {
    contributions.forEach((contribution, index) =>
      add(
        'slot-contribution',
        path,
        String(index + 1),
        `"${contribution.name}" in ${contribution.slot}`,
      ),
    );
  }
  for (const custom of inventory.customCode) {
    if (custom.hasCode) add('custom-code', custom.path, 'code', 'customer code');
  }
  for (const script of inventory.scripts) {
    add('script', script.path, String(script.index + 1), `script ${script.index + 1}`);
  }
  inventory.dashboard?.cards.forEach((card, index) =>
    add(
      'dashboard-card',
      inventory.dashboard?.path ?? '',
      String(index + 1),
      `card ${index + 1}${card.heading ? `, ${card.heading}` : ''}`,
    ),
  );
  for (const theme of inventory.themes) {
    theme.properties.forEach((property, index) =>
      add('theme-property', theme.path, String(index + 1), property.name),
    );
  }
  for (const translations of inventory.translations) {
    for (const key of translations.keys)
      add('translation', translations.path, key, `${translations.locale}: ${key}`);
  }

  // Every file not yet accounted for is a construct of its own: a file of a kind that holds no
  // constructs, and a container that turned out to hold none.
  const accounted = new Set(constructs.map((construct) => construct.file));
  for (const file of inventory.files) {
    if (!accounted.has(file.path)) {
      add(
        'file',
        file.path,
        'file',
        CONTAINERS.has(file.kind) ? `${file.kind}, holding nothing` : file.kind,
      );
    }
  }
  return constructs;
}

/** How many constructs of each counted kind each file holds, keyed `<kind> <file>`. */
export function countsOf(constructs: readonly Construct[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const construct of constructs) {
    if (!COUNTED_KINDS.includes(construct.kind)) continue;
    const key = `${construct.kind} ${construct.file}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function fieldLabel(binding: string | null, label: string | null, element: string): string {
  return `${binding ?? element}${label ? ` ("${label.replace(/\s+/g, ' ').trim()}")` : ''}`;
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  return groups;
}
