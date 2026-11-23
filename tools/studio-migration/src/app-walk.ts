/**
 * Reading back what a converted app definition shows: the field entries of a layout file, in
 * either version, and the columns of a queue. The harness reads these, never the conversion's
 * report, to see what a file holds.
 */
import { isRecord } from '@agentic-ui/shared/app-definition';

export interface ShownField {
  /** The property, `<prefix>:<name>`, or `null` for an entry that names none. */
  readonly field: string | null;
  /** The entry as the file writes it: a string, or an object. */
  readonly entry: unknown;
  /** Where it is in the file, as the validator names a place: `cards.0.fields.1`. */
  readonly at: string;
}

/** The property an entry shows: the string itself, or its `field`. */
export function fieldOf(entry: unknown): string | null {
  if (typeof entry === 'string') return entry;
  return isRecord(entry) && typeof entry['field'] === 'string' ? entry['field'] : null;
}

export function widgetOf(entry: unknown): string | null {
  return isRecord(entry) && typeof entry['widget'] === 'string' ? entry['widget'] : null;
}

export function parametersOf(entry: unknown): Readonly<Record<string, unknown>> {
  return isRecord(entry) && isRecord(entry['parameters']) ? entry['parameters'] : {};
}

/** Every field entry of a layout file: version 1's sections, version 2's cards and tabs. */
export function layoutFields(file: unknown): ShownField[] {
  if (!isRecord(file)) return [];
  const found: ShownField[] = [];
  const fieldsOf = (holder: unknown, at: string): void => {
    if (!isRecord(holder) || !Array.isArray(holder['fields'])) return;
    holder['fields'].forEach((entry, index) =>
      found.push({ field: fieldOf(entry), entry, at: `${at}.fields.${index}` }),
    );
  };
  const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
  listOf(file['sections']).forEach((section, index) => fieldsOf(section, `sections.${index}`));
  listOf(file['cards']).forEach((card, index) => fieldsOf(card, `cards.${index}`));
  listOf(file['tabs']).forEach((tab, tabIndex) =>
    listOf(isRecord(tab) ? tab['cards'] : undefined).forEach((card, index) =>
      fieldsOf(card, `tabs.${tabIndex}.cards.${index}`),
    ),
  );
  return found;
}

/** The columns of a queue, or of anything with `columns`, in order. */
export function listColumns(file: unknown): ShownField[] {
  if (!isRecord(file) || !Array.isArray(file['columns'])) return [];
  return file['columns'].map((entry, index) => ({
    field: fieldOf(entry),
    entry,
    at: `columns.${index}`,
  }));
}

/**
 * Every place a file of an app definition names a rule, by its path in the package, each with
 * where it is. Only the places a rule can sit are read (layout-v2.md, section 5, and
 * app-definition-v2.md, sections 4 and 5):
 *
 * - **a layout or task form:** a tab's, a card's and a field's `visibleWhen`, a field's
 *   `readOnlyWhen`, a `required` that is a rule rather than `true` or `false`, and the rule of a
 *   `core.choose` computation; and the same in a table's columns and a related list's columns;
 * - **a queue:** its `visibleWhen`, and its columns' as a field's;
 * - **`actions.json`:** each action's `visibleWhen`;
 * - **`home.json` and `navigation.json`:** each card's and each entry's `visibleWhen`.
 *
 * A labels file, a module's settings, `app.json` and an operation's parameters hold none: a
 * translation key or a parameter named `required` is text, not a rule.
 */
export function rulesIn(
  path: string,
  file: unknown,
): { readonly at: string; readonly rule: unknown }[] {
  const found: { at: string; rule: unknown }[] = [];
  const rule = (holder: Record<string, unknown>, key: string, at: string): void => {
    if (key in holder) found.push({ at: `${at}${key}`, rule: holder[key] });
  };
  const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
  const field = (entry: unknown, at: string): void => {
    if (!isRecord(entry)) return;
    rule(entry, 'visibleWhen', at);
    rule(entry, 'readOnlyWhen', at);
    if ('required' in entry && typeof entry['required'] !== 'boolean')
      found.push({ at: `${at}required`, rule: entry['required'] });
    const computed = entry['computed'];
    if (isRecord(computed) && computed['type'] === 'core.choose') {
      const [chosen] = list(computed['parameters']);
      if (chosen !== undefined) found.push({ at: `${at}computed.parameters.0`, rule: chosen });
    }
    const parameters = entry['parameters'];
    if (isRecord(parameters))
      list(parameters['columns']).forEach((column, index) =>
        field(column, `${at}parameters.columns.${index}.`),
      );
  };
  const card = (value: unknown, at: string): void => {
    if (!isRecord(value)) return;
    rule(value, 'visibleWhen', at);
    list(value['fields']).forEach((entry, index) => field(entry, `${at}fields.${index}.`));
    const related = value['related'];
    if (isRecord(related))
      list(related['columns']).forEach((entry, index) =>
        field(entry, `${at}related.columns.${index}.`),
      );
  };
  if (!isRecord(file)) return found;
  if (/^(layouts|tasks)\//.test(path)) {
    list(file['cards']).forEach((value, index) => card(value, `cards.${index}.`));
    list(file['sections']).forEach((value, index) => card(value, `sections.${index}.`));
    list(file['tabs']).forEach((tab, tabIndex) => {
      if (!isRecord(tab)) return;
      rule(tab, 'visibleWhen', `tabs.${tabIndex}.`);
      list(tab['cards']).forEach((value, index) => card(value, `tabs.${tabIndex}.cards.${index}.`));
    });
  } else if (path.startsWith('queues/')) {
    rule(file, 'visibleWhen', '');
    list(file['columns']).forEach((entry, index) => field(entry, `columns.${index}.`));
  } else if (path === 'home.json') {
    list(file['cards']).forEach((card, index) => {
      if (isRecord(card)) rule(card, 'visibleWhen', `cards.${index}.`);
    });
  } else if (path === 'navigation.json') {
    list(file['entries']).forEach((entry, index) => {
      if (isRecord(entry)) rule(entry, 'visibleWhen', `entries.${index}.`);
    });
  } else if (path === 'actions.json') {
    list(file['actions']).forEach((action, index) => {
      if (isRecord(action)) rule(action, 'visibleWhen', `actions.${index}.`);
    });
  }
  return found;
}

/** Structural equality of two JSON values. */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => sameJson(item, b[index]))
    );
  }
  if (!isRecord(a) || !isRecord(b)) return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && sameJson(a[key], b[key]))
  );
}
