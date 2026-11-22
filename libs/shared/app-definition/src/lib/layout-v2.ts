/**
 * The validator of layout file version 2 (docs/business-apps/layout-v2.md), and of task forms,
 * which are layout files for one workflow step (app-definition-v2.md, section 6).
 *
 * It returns every finding, each with where it is and what kind it is, and leaves the verdict to
 * the caller, because section 8 of the proposal wants two:
 *
 * - **strict when built:** the pipeline refuses a package with any finding at all;
 * - **tolerant when loaded:** the app refuses the file only for a `structure` finding, and leaves
 *   out the card or field an `unknown` or `parameter` finding is in, so that a file written for a
 *   later platform still shows what this one knows.
 *
 * It checks the file against itself and the registries. It does not check a property against the
 * content model, which only phase 1's model reader can do: a field naming a property the type
 * lacks passes here and is skipped when the record page renders.
 */
import {
  CHECK_KEYS,
  createChecker,
  FIELD_KEYS,
  join,
  unreadable,
  type Checker,
  type Finding,
} from './checker';
import { isRecord, PACKAGED_REGISTRIES, type Registries } from './registries';

export type { Finding } from './checker';

export type LayoutMode = 'view' | 'metadata' | 'edit' | 'create';
export const LAYOUT_MODES: readonly LayoutMode[] = ['view', 'metadata', 'edit', 'create'];

export interface ValidationOptions {
  readonly mode: LayoutMode;
  readonly registries?: Registries;
}

const FILE_KEYS = ['$schema', 'version', 'columns', 'cards', 'tabs'];
const TAB_KEYS = ['id', 'label', 'labelKey', 'visibleWhen', 'cards'];
const CARD_KEYS = ['id', 'label', 'labelKey', 'span', 'visibleWhen', 'fields', 'related'];
const RELATED_KEYS = ['pageProvider', 'parameters', 'columns', 'sort', 'pageSize', 'rowActions'];

/** The keys each part of a file may hold, which the JSON Schema must list too (its own test checks). */
export const LAYOUT_V2_KEYS = {
  file: FILE_KEYS,
  tab: TAB_KEYS,
  card: CARD_KEYS,
  field: FIELD_KEYS,
  related: RELATED_KEYS,
  check: CHECK_KEYS,
} as const;

export function validateLayoutV2(content: unknown, options: ValidationOptions): Finding[] {
  return layout(content, options.mode, options.registries ?? PACKAGED_REGISTRIES, false);
}

/**
 * A task form: an edit-mode layout file whose `var:` fields are the step's variables, the only
 * fields it edits. The record's own properties show read-only.
 */
export function validateTaskForm(
  content: unknown,
  options: { readonly registries?: Registries } = {},
): Finding[] {
  return layout(content, 'edit', options.registries ?? PACKAGED_REGISTRIES, true);
}

function layout(
  content: unknown,
  mode: LayoutMode,
  registries: Registries,
  task: boolean,
): Finding[] {
  const stop = unreadable(content, task ? 'a task form' : 'a layout file');
  if (stop) return stop;
  const file = content as Record<string, unknown>;
  if (!LAYOUT_MODES.includes(mode)) {
    return [
      {
        path: '',
        kind: 'structure',
        message: `"${mode}" is not a mode: ${LAYOUT_MODES.join(', ')}`,
      },
    ];
  }
  const c = createChecker(registries, { task });
  const view = mode === 'view';
  const form = mode === 'edit' || mode === 'create';

  const card = (item: unknown, path: string, columns: number): void => {
    if (!isRecord(item)) {
      c.add(path, 'structure', 'a card is an object');
      return;
    }
    c.unknownKeys(item, CARD_KEYS, path);
    c.claim(item['id'], join(path, 'id'));
    c.label(item, path);
    if ('span' in item) {
      if (!view) c.add(join(path, 'span'), 'structure', 'span belongs in view mode only');
      else if (!(
        Number.isInteger(item['span']) &&
        (item['span'] as number) >= 1 &&
        (item['span'] as number) <= columns
      )) {
        c.add(
          join(path, 'span'),
          'structure',
          `span is a whole number from 1 to the file's ${columns} columns`,
        );
      }
    }
    if ('visibleWhen' in item) c.rule(item['visibleWhen'], join(path, 'visibleWhen'));
    const hasFields = 'fields' in item;
    const hasRelated = 'related' in item;
    if (hasFields === hasRelated)
      c.add(path, 'structure', 'a card has "fields" or "related", one of the two');
    if (hasFields) {
      const fields = item['fields'];
      if (!Array.isArray(fields)) c.add(join(path, 'fields'), 'structure', 'fields must be a list');
      else
        fields.forEach((entry, index) => c.field(entry, join(join(path, 'fields'), index), form));
    }
    if (hasRelated) {
      if (!view)
        c.add(join(path, 'related'), 'structure', 'related records belong in view mode only');
      else related(c, item['related'], join(path, 'related'));
    }
  };

  const cards = (list: unknown, path: string, columns: number): void => {
    if (!Array.isArray(list)) {
      c.add(path, 'structure', 'cards must be a list');
      return;
    }
    list.forEach((item, index) => card(item, join(path, index), columns));
  };

  c.unknownKeys(file, FILE_KEYS, '');
  c.schemaKey(file);
  let columns = 1;
  if ('columns' in file) {
    if (!view) c.add('columns', 'structure', 'columns belongs in view mode only');
    else if (!(
      Number.isInteger(file['columns']) &&
      (file['columns'] as number) >= 1 &&
      (file['columns'] as number) <= 3
    )) {
      c.add('columns', 'structure', 'columns is 1, 2 or 3');
    } else columns = file['columns'] as number;
  }
  const hasCards = 'cards' in file;
  const hasTabs = 'tabs' in file;
  if (hasCards === hasTabs) c.add('', 'structure', 'a file has "cards" or "tabs", one of the two');
  if (hasCards) cards(file['cards'], 'cards', columns);
  if (hasTabs) {
    const tabs = file['tabs'];
    if (!Array.isArray(tabs)) c.add('tabs', 'structure', 'tabs must be a list');
    else
      tabs.forEach((tab, index) => {
        const path = join('tabs', index);
        if (!isRecord(tab)) {
          c.add(path, 'structure', 'a tab is an object');
          return;
        }
        c.unknownKeys(tab, TAB_KEYS, path);
        c.claim(tab['id'], join(path, 'id'));
        c.label(tab, path);
        if ('visibleWhen' in tab) c.rule(tab['visibleWhen'], join(path, 'visibleWhen'));
        cards(tab['cards'], join(path, 'cards'), columns);
      });
  }
  return c.findings;
}

/** A card's related records: a list of records from a page provider (layout-v2.md, section 7). */
function related(c: Checker, item: unknown, path: string): void {
  if (!isRecord(item)) {
    c.add(path, 'structure', 'related is an object');
    return;
  }
  c.unknownKeys(item, RELATED_KEYS, path);
  c.list(item, path, { openRecord: true });
}

/** True when the pipeline may publish the file: no finding at all. */
export function publishable(findings: readonly Finding[]): boolean {
  return findings.length === 0;
}

/** True when the app may load the file, leaving out what an `unknown` or `parameter` finding names. */
export function loadable(findings: readonly Finding[]): boolean {
  return findings.every((finding) => finding.kind !== 'structure');
}
