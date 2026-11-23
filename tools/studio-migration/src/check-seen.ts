/**
 * Check 6, what people see (docs/business-apps/studio-migration.md, section 6): both apps show the
 * same labels and values on the same records.
 *
 * The labels are in the package and the conversion, so that half runs without a server: each
 * field, column and list is named in the new app as Web UI names it. The new app's label is
 * worked out as it works one out (extension-reference.md, section 9b): the `label`; else the
 * `labelKey`'s text in the package's labels; else `layout.field.<prefix>:<name>`'s; else the name,
 * made readable. A label that rests on a catalogue the package does not hold, Web UI's own or the
 * app's, is listed instead of compared.
 *
 * The values half opens the same records in both apps, as the same user, and needs the migration
 * server: it has not run, and the check says so.
 */
import { isRecord } from '@agentic-ui/shared/app-definition';
import {
  LAYOUT_VERSION,
  homeQueueId,
  labelOf,
  layoutPath,
  queuePath,
  searchQueueId,
} from './app-files';
import { layoutFields, listColumns } from './app-walk';
import { listed } from './check-model';
import { labelsOf, readCatalogue } from './convert';
import { PANEL_ROWS } from './convert-layouts';
import { menuLabel } from './convert-lists';
import type { CheckOutcome, HarnessInput } from './harness';

/** A label the comparison cannot settle, because its text is in a catalogue not in hand. */
const UNKNOWN = Symbol('unknown');
type Resolved = string | typeof UNKNOWN | null;

export function checkSeen({ pkg, inventory, conversion }: HarnessInput): CheckOutcome {
  const findings: string[] = [];
  const unsettled = new Set<string>();
  const locale =
    inventory.translations.find((t) => t.locale === 'en')?.locale ??
    inventory.translations[0]?.locale ??
    'en';
  const webTexts: Record<string, unknown> = {};
  for (const translations of inventory.translations.filter((t) => t.locale === locale))
    Object.assign(webTexts, readCatalogue(pkg, translations.path));
  const appTexts = labelsOf(conversion)[locale] ?? {};

  /** What Web UI shows for a label as its file writes it. */
  const web = (text: string | null): Resolved => {
    const label = labelOf(text);
    if ('label' in label) return label.label;
    if ('labelKey' in label) {
      const value = Object.hasOwn(webTexts, label.labelKey) ? webTexts[label.labelKey] : undefined;
      if (typeof value === 'string') return normal(value);
      unsettled.add(`Web UI's ${label.labelKey}`);
      return UNKNOWN;
    }
    return null;
  };
  /** What the new app shows for an entry, a list or a field, as it works the label out. */
  const shown = (entry: unknown, fallbackKey: string | null, name: string | null): Resolved => {
    if (isRecord(entry) && typeof entry['label'] === 'string') return normal(entry['label']);
    if (isRecord(entry) && typeof entry['labelKey'] === 'string') {
      const key = entry['labelKey'];
      if (Object.hasOwn(appTexts, key)) return normal(appTexts[key]);
      unsettled.add(`the app's ${key}`);
      return UNKNOWN;
    }
    if (fallbackKey !== null && Object.hasOwn(appTexts, fallbackKey))
      return normal(appTexts[fallbackKey]);
    return name === null ? null : readable(name);
  };
  const compare = (where: string, webLabel: Resolved, appLabel: Resolved): void => {
    if (webLabel === null || webLabel === UNKNOWN || appLabel === UNKNOWN) return;
    if (appLabel !== webLabel)
      findings.push(
        `${where}: the app shows ${JSON.stringify(appLabel)}, where Web UI shows ${JSON.stringify(webLabel)}`,
      );
  };

  for (const layout of inventory.layouts) {
    if (layout.docType === null || !Object.hasOwn(LAYOUT_VERSION, layout.mode)) continue;
    const path = layoutPath(layout.docType, layout.mode);
    const fields = layoutFields(conversion.app[path]);
    const seen = new Set<string>();
    for (const field of layout.fields) {
      if (field.binding === null || seen.has(field.binding)) continue;
      seen.add(field.binding);
      if (layout.mode === 'metadata' && PANEL_ROWS.has(field.binding)) continue;
      const match = fields.find((candidate) => candidate.field === field.binding);
      if (!match) continue;
      const name = field.binding.slice(field.binding.indexOf(':') + 1);
      compare(
        `${path}: ${field.binding}`,
        web(field.label),
        shown(match.entry, `layout.field.${field.binding}`, name),
      );
    }
  }

  for (const search of inventory.searches) {
    if (search.part !== 'results') continue;
    const path = queuePath(searchQueueId(search));
    const queue = conversion.app[path];
    if (queue === undefined) continue;
    const menu = menuLabel({ inventory }, search);
    if (menu !== null) compare(`${path}: its name`, web(menu), shown(queue, null, null));
    for (const column of listColumns(queue)) {
      const source = search.columnDetails.find((candidate) => candidate.field === column.field);
      if (source)
        compare(
          `${path}: the column ${column.field}`,
          web(source.name),
          shown(column.entry, null, null),
        );
    }
  }
  inventory.dashboard?.cards.forEach((card, index) => {
    const path = queuePath(homeQueueId(card, index));
    const queue = conversion.app[path];
    if (queue === undefined) return;
    compare(`${path}: its name`, web(card.heading), shown(queue, null, null));
    for (const column of listColumns(queue)) {
      const source = card.columns.find((candidate) => candidate.field === column.field);
      if (source)
        compare(
          `${path}: the column ${column.field}`,
          web(source.name),
          shown(column.entry, null, null),
        );
    }
  });

  const values =
    'The values half opens the same records in both apps, as the same user, and needs the migration server';
  return {
    findings,
    rest:
      unsettled.size > 0
        ? `${values}. ${unsettled.size} ${unsettled.size === 1 ? 'label rests' : 'labels rest'} on a catalogue the package does not hold: ${listed([...unsettled])}`
        : values,
  };
}

function normal(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * A field name made readable, as the app's `humanize` in libs/shared/document-layouts does:
 * `billedAmount` is "Billed amount", and an acronym such as `ID` keeps its capitals. Copied, not
 * imported: that library is Angular, and this tool runs in Node.
 */
export function readable(name: string): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])(?=[A-Z][a-z])/g, '$1 ')
    .split(/[\s_.-]+/)
    .filter(Boolean)
    .map((word) => (word.length > 1 && word === word.toUpperCase() ? word : word.toLowerCase()));
  const text = words.join(' ');
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : name;
}
