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
  | 'task-layout'
  | 'task-field'
  | 'layout-block'
  | 'block-use'
  | 'block-field'
  | 'search'
  | 'search-field'
  | 'search-column'
  | 'search-view'
  | 'condition'
  | 'slot-contribution'
  | 'custom-code'
  | 'custom-element'
  | 'script'
  | 'dashboard-card'
  | 'theme-property'
  | 'translation';

/** The kinds both counts cover. A file of one of these kinds holds them. */
export const COUNTED_KINDS: readonly ConstructKind[] = [
  'layout-field',
  'task-field',
  'block-use',
  'block-field',
  'search-field',
  'search-column',
  'search-view',
  'condition',
  'slot-contribution',
  'custom-element',
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
  /** For a field or a column: the property it shows, as `<prefix>:<name>`, or the parameter it fills. */
  readonly property?: string;
}

/** Files whose content is read construct by construct. A file of another kind is one construct. */
const CONTAINERS: ReadonlySet<FileKind> = new Set<FileKind>([
  'document-layout',
  'task-layout',
  'layout-block',
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
  const add = (
    kind: ConstructKind,
    file: string,
    key: string,
    label: string,
    property?: string | null,
  ): void => {
    constructs.push({
      id: `${kind}:${file}#${key}`,
      kind,
      file,
      label,
      ...(property ? { property } : {}),
    });
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
        field.binding,
      ),
    );
  }
  for (const task of inventory.taskLayouts) {
    add(
      'task-layout',
      task.path,
      'layout',
      `the task layout of step ${task.step} of ${task.workflow}`,
    );
    task.fields.forEach((field, index) =>
      add(
        'task-field',
        task.path,
        String(index + 1),
        fieldLabel(field.binding, field.label, field.element),
        field.binding,
      ),
    );
  }
  for (const block of inventory.blocks) {
    add('layout-block', block.path, 'block', `the layout block ${block.element}`);
  }
  // A block's fields show where it is used, as many times as it is: each use's fields are
  // constructs of the file that uses it, each decided where it shows.
  for (const use of inventory.blockUses) {
    add('block-use', use.path, String(use.index + 1), `the layout block ${use.element}`);
    const block = inventory.blocks.find((candidate) => candidate.path === use.block);
    block?.fields.forEach((field, index) =>
      add(
        'block-field',
        use.path,
        `${use.index + 1}.${index + 1}`,
        `${use.element}: ${fieldLabel(field.binding, field.label, field.element)}`,
        field.binding,
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
        field.binding,
      ),
    );
    search.columnDetails.forEach((column, index) =>
      add(
        'search-column',
        search.path,
        String(index + 1),
        `column ${index + 1}${column.field ? `, ${column.field}` : ''}`,
        column.field,
      ),
    );
    search.views.forEach((view, index) =>
      add('search-view', search.path, String(index + 1), `the ${view} view`),
    );
  }
  for (const condition of inventory.conditions) {
    add(
      'condition',
      condition.path,
      String(condition.index + 1),
      `a ${condition.element === 'template' ? 'dom-if' : condition.element} condition`,
    );
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
    if (custom.hasOtherCode) add('custom-code', custom.path, 'code', 'customer code');
  }
  for (const element of inventory.customElements) {
    add(
      'custom-element',
      element.path,
      String(element.index + 1),
      `the custom element ${element.name}`,
    );
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
