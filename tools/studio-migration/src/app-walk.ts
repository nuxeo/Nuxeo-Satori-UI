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
 * Every place a file names a rule: `visibleWhen` and `readOnlyWhen` anywhere, and a `required`
 * that is not plain `true`. Each with where it is.
 */
export function rulesIn(file: unknown, at = ''): { readonly at: string; readonly rule: unknown }[] {
  const found: { at: string; rule: unknown }[] = [];
  const visit = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, path ? `${path}.${index}` : String(index)));
      return;
    }
    if (!isRecord(value)) return;
    for (const [key, inner] of Object.entries(value)) {
      const place = path ? `${path}.${key}` : key;
      if (key === 'visibleWhen' || key === 'readOnlyWhen' || (key === 'required' && inner !== true))
        found.push({ at: place, rule: inner });
      else visit(inner, place);
    }
  };
  visit(file, at);
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
