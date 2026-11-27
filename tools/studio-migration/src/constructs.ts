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
import { createHash } from 'node:crypto';
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
  'script',
  'dashboard-card',
  'theme-property',
  'translation',
];

export interface Construct {
  /**
   * Unique within the package, and the same every time the package is read. It is the
   * construct's place in its file, so another build of the package can give it to another
   * construct.
   */
  readonly id: string;
  /**
   * What the construct is, rather than where: a fingerprint of its kind, the file that owns it,
   * and what it is in that file (`identityOf`). The same in every build in which the construct is
   * unchanged, wherever it moved in its file; shared by constructs a build cannot tell apart, such
   * as two fields of one layout binding one property.
   */
  readonly identity: string;
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
    property: string | null | undefined,
    what: readonly unknown[],
  ): void => {
    constructs.push({
      id: `${kind}:${file}#${key}`,
      identity: identityOf(kind, file, what),
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
      null,
      [layout.docType, layout.mode],
    );
    layout.fields.forEach((field, index) =>
      add(
        'layout-field',
        layout.path,
        String(index + 1),
        fieldLabel(field.binding, field.label, field.element),
        field.binding,
        fieldWhat(field),
      ),
    );
  }
  for (const task of inventory.taskLayouts) {
    add(
      'task-layout',
      task.path,
      'layout',
      `the task layout of step ${task.step} of ${task.workflow}`,
      null,
      [task.workflow, task.step],
    );
    task.fields.forEach((field, index) =>
      add(
        'task-field',
        task.path,
        String(index + 1),
        fieldLabel(field.binding, field.label, field.element),
        field.binding,
        fieldWhat(field),
      ),
    );
  }
  for (const block of inventory.blocks) {
    add('layout-block', block.path, 'block', `the layout block ${block.element}`, null, [
      block.element,
    ]);
  }
  // A block's fields show where it is used, as many times as it is: each use's fields are
  // constructs of the file that uses it, each decided where it shows.
  for (const use of inventory.blockUses) {
    add('block-use', use.path, String(use.index + 1), `the layout block ${use.element}`, null, [
      use.element,
      use.block,
    ]);
    const block = inventory.blocks.find((candidate) => candidate.path === use.block);
    block?.fields.forEach((field, index) =>
      add(
        'block-field',
        use.path,
        `${use.index + 1}.${index + 1}`,
        `${use.element}: ${fieldLabel(field.binding, field.label, field.element)}`,
        field.binding,
        [use.element, use.block, ...fieldWhat(field)],
      ),
    );
  }
  for (const search of inventory.searches) {
    add(
      'search',
      search.path,
      'search',
      `the search ${search.part} of ${search.provider ?? 'an unnamed provider'}`,
      null,
      [search.part, search.provider],
    );
    search.fields.forEach((field, index) =>
      add(
        'search-field',
        search.path,
        String(index + 1),
        fieldLabel(field.binding, field.label, field.element),
        field.binding,
        fieldWhat(field),
      ),
    );
    search.columnDetails.forEach((column, index) =>
      add(
        'search-column',
        search.path,
        String(index + 1),
        `column ${index + 1}${column.field ? `, ${column.field}` : ''}`,
        column.field,
        [column.field, column.name],
      ),
    );
    search.views.forEach((view, index) =>
      add('search-view', search.path, String(index + 1), `the ${view} view`, null, [view]),
    );
  }
  for (const condition of inventory.conditions) {
    add(
      'condition',
      condition.path,
      String(condition.index + 1),
      `a ${condition.element === 'template' ? 'dom-if' : condition.element} condition`,
      null,
      // Its test, whatever the order of its attributes: a condition that tests something else is
      // another condition.
      [
        condition.element,
        Object.entries(condition.attributes).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      ],
    );
  }
  for (const [path, contributions] of groupBy(inventory.slotContributions, (c) => c.path)) {
    contributions.forEach((contribution, index) =>
      add(
        'slot-contribution',
        path,
        String(index + 1),
        `"${contribution.name}" in ${contribution.slot}`,
        null,
        [contribution.slot, contribution.name],
      ),
    );
  }
  for (const custom of inventory.customCode) {
    if (custom.hasCode) add('custom-code', custom.path, 'code', 'customer code', null, []);
  }
  for (const script of inventory.scripts) {
    add('script', script.path, String(script.index + 1), `script ${script.index + 1}`, null, [
      script.shape,
    ]);
  }
  inventory.dashboard?.cards.forEach((card, index) =>
    add(
      'dashboard-card',
      inventory.dashboard?.path ?? '',
      String(index + 1),
      `card ${index + 1}${card.heading ? `, ${card.heading}` : ''}`,
      null,
      // A repeat is told from the card it repeats, though not from another repeat of it.
      [card.heading, card.provider, card.operation, card.params, card.repeatOf !== null],
    ),
  );
  for (const theme of inventory.themes) {
    theme.properties.forEach((property, index) =>
      add('theme-property', theme.path, String(index + 1), property.name, null, [property.name]),
    );
  }
  for (const translations of inventory.translations) {
    for (const key of translations.keys)
      add('translation', translations.path, key, `${translations.locale}: ${key}`, null, [key]);
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
        null,
        [],
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

/**
 * A construct's identity: a fingerprint of its kind, the file that owns it, and `what` it is in
 * that file, such as a field's element and the property it binds. Studio names a package's files
 * after what they hold, a layout after its type and mode, so the file is part of what a construct
 * is; its place among the file's constructs is not.
 */
export function identityOf(kind: ConstructKind, file: string, what: readonly unknown[]): string {
  const digest = createHash('sha256')
    .update(JSON.stringify([kind, file, what]))
    .digest('hex');
  return `${kind}:${digest.slice(0, 16)}`;
}

/** What a field is in its layout: its element and the property it binds, or its label. */
function fieldWhat(field: {
  readonly element: string;
  readonly binding: string | null;
  readonly label: string | null;
}): unknown[] {
  return [field.element, field.binding, field.binding === null ? field.label : null];
}

/** Each construct's identity, by its id. */
export function identitiesOf(inventory: Inventory): Map<string, string> {
  return new Map(constructsOf(inventory).map((construct) => [construct.id, construct.identity]));
}

/**
 * The identities a build cannot tell apart: held by more than one of its constructs. A decision
 * on one of them is never carried to another build, where which one it was made on is unknown.
 */
export function sharedIdentities(constructs: readonly Pick<Construct, 'identity'>[]): Set<string> {
  const seen = new Set<string>();
  const shared = new Set<string>();
  for (const { identity } of constructs) {
    if (seen.has(identity)) shared.add(identity);
    seen.add(identity);
  }
  return shared;
}

function fieldLabel(binding: string | null, label: string | null, element: string): string {
  return `${binding ?? element}${label ? ` ("${label.replace(/\s+/g, ' ').trim()}")` : ''}`;
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  return groups;
}
