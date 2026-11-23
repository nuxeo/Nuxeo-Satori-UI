import { PACKAGED_WIDGETS } from '@agentic-ui/shared/app-definition';

import type { LayoutFieldType, LayoutLabel } from '../layout.model';
import { humanize } from '../resolve-layout';

/**
 * What both the resolution of a record page and its widgets need to agree on: which widget shows
 * which property type, which widgets this build shows as version 1 would, and how a table's
 * columns are read.
 */

/**
 * The widgets this build shows as version 1 would, until each has its own lookup: `image` and
 * `file-list` need the file fetched through the blob service, and `document-link` the linked
 * record's title. Shown by name or stored id meanwhile, and said so in the console.
 */
export const WIDGETS_SHOWN_AS_VERSION_1: ReadonlySet<string> = new Set([
  'image',
  'file-list',
  'document-link',
]);

/**
 * The property type a widget's `accepts` is written in. Nuxeo reports some numeric fields as
 * `integer`, which the widgets, like the schema language, call `long`.
 */
export function widgetPropertyType(definition: LayoutFieldType): string {
  return definition.type.replace(/^integer(?=$|\[\]$)/, 'long');
}

/** Whether `widget` shows a property of this type (layout-v2.md, section 3). */
export function widgetAccepts(widget: string, definition: LayoutFieldType): boolean {
  const accepts: readonly string[] | undefined = PACKAGED_WIDGETS[widget]?.accepts;
  return accepts?.includes(widgetPropertyType(definition)) ?? false;
}

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A column of a `table` widget, read from its `columns` parameter: a field entry over a subfield. */
export interface TableColumn {
  /** Its position in `columns`, for the console. */
  readonly index: number;
  /** The subfield each row holds it under: the `<name>` of `<prefix>:<name>`. */
  readonly subfield: string;
  readonly label: LayoutLabel;
  readonly widget: string | null;
  readonly parameters: Json;
  /** A rule: the column shows only while it passes, as a field does. */
  readonly visibleWhen: unknown;
}

/**
 * The columns a `table` widget's `columns` parameter names. A computed column is not one: the
 * reader reports it and this build does not draw it.
 */
export function tableColumns(parameter: unknown): TableColumn[] {
  return (Array.isArray(parameter) ? parameter : []).flatMap((entry: unknown, index) => {
    const field = typeof entry === 'string' ? entry : isRecord(entry) ? entry['field'] : undefined;
    if (typeof field !== 'string' || !field.includes(':')) return [];
    const subfield = field.slice(field.indexOf(':') + 1);
    const object = isRecord(entry) ? entry : {};
    const literal = typeof object['label'] === 'string' ? object['label'] : undefined;
    const labelKey = typeof object['labelKey'] === 'string' ? object['labelKey'] : undefined;
    return [
      {
        index,
        subfield,
        label: {
          ...(literal ? { literal } : {}),
          keys: labelKey ? [labelKey] : [],
          fallback: humanize(subfield),
        },
        widget: typeof object['widget'] === 'string' ? object['widget'] : null,
        parameters: isRecord(object['parameters']) ? object['parameters'] : {},
        visibleWhen: object['visibleWhen'] ?? null,
      },
    ];
  });
}
