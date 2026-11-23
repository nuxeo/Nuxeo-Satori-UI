/**
 * Which layout version 2 widget a Web UI element becomes: docs/business-apps/layout-v2.md,
 * section 10, read from the catalogue's `widget` and `parameters`.
 *
 * The converter writes these widgets and harness check 2 expects them, so both read this one
 * table, and its tests pin it case by case. `null` means the property's schema type picks the
 * widget, as for a plain text or number field, or a label beside a bound value.
 */
import { elementEntry, own, type Catalogue } from './catalogue';
import type { ResultColumn } from './inventory';

export interface WidgetChoice {
  readonly widget: string | null;
  readonly parameters?: Readonly<Record<string, string>>;
}

/**
 * The widget a field element becomes, or `null` when the element is not a field: an element the
 * catalogue does not list, or lists as something else, such as the document viewer.
 */
export function fieldWidget(
  catalogue: Catalogue,
  element: string,
  attributes: Readonly<Record<string, string>>,
): WidgetChoice | null {
  // A label beside a bound value, as a view or metadata layout writes a read-only field.
  if (!element.includes('-')) return { widget: null };
  const entry = elementEntry(catalogue, element);
  if (!entry || entry.role !== 'field' || entry.widget === undefined) return null;
  let widget = entry.widget;
  if (element === 'nuxeo-date' && own(attributes, 'format')?.trim() === 'relative')
    widget = 'relative-date';
  if (
    element === 'nuxeo-user-suggestion' &&
    own(attributes, 'search-type')?.trim() === 'GROUP_TYPE'
  )
    widget = 'group';
  const parameters: Record<string, string> = {};
  for (const [parameter, attribute] of Object.entries(entry.parameters ?? {})) {
    const value = own(attributes, attribute)?.trim();
    if (value) parameters[parameter] = value;
  }
  return Object.keys(parameters).length > 0 ? { widget, parameters } : { widget };
}

/** How a column of a list shows its value, read from what its template holds. */
export function columnWidget(column: ResultColumn): string | null {
  if (column.elements.includes('nuxeo-user-tag')) return 'user';
  if (column.elements.includes('nuxeo-tag')) return 'chips';
  if (column.elements.includes('nuxeo-date'))
    return column.dateFormat?.trim() === 'relative' ? 'relative-date' : 'date';
  if (column.formatsDate) return 'date';
  return null;
}

/**
 * The widgets a version 1 file still shows, because the schema type picks them: a date picker for
 * a date, chips for a list. Version 1 cannot name any other (extension-reference.md, section 9b).
 */
export const VERSION_ONE_WIDGETS: ReadonlySet<string> = new Set(['date', 'chips']);
