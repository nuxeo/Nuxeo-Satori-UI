/**
 * Check 2, fields (docs/business-apps/studio-migration.md, section 6): each converted layout shows
 * the fields its Web UI layout binds, in the same mode, with the same required flags and the
 * widgets layout-v2.md, section 10, expects; and each list shows its columns, in order, with
 * theirs.
 *
 * What Web UI shows is read from the package, field by field, less the repeats and the fields
 * that sit in a condition, which check 5 holds. The report is read only to excuse a field that
 * is missing: one it reports or leaves pending, with its reason, is accounted for, and blocks
 * readiness instead.
 */
import { isRecord } from '@agentic-ui/shared/app-definition';
import { LAYOUT_VERSION, layoutPath } from './app-files';
import { layoutFields, listColumns, parametersOf, sameJson, widgetOf } from './app-walk';
import { PANEL_ROWS } from './convert-layouts';
import { queueOwners } from './convert-lists';
import type { CheckOutcome, HarnessInput } from './harness';
import type { ResultColumn } from './inventory';
import { VERSION_ONE_WIDGETS, columnWidget, fieldWidget } from './widgets';

const XPATH = /^[A-Za-z_][\w-]*:[A-Za-z_][\w-]*$/;

export function checkFields({ inventory, catalogue, conversion }: HarnessInput): CheckOutcome {
  const findings: string[] = [];
  const app = conversion.app;
  const entries = new Map((conversion.report.constructs ?? []).map((entry) => [entry.id, entry]));
  /** True when the report accounts for a construct some other way than converting it. */
  const excused = (id: string): boolean => {
    const entry = entries.get(id);
    return entry !== undefined && entry.outcome !== 'converted' && Boolean(entry.note?.trim());
  };
  const layoutFiles = new Set(Object.keys(app).filter((path) => path.startsWith('layouts/')));
  const compared = new Set<string>();

  for (const layout of inventory.layouts) {
    const type = layout.docType;
    if (type === null || !Object.hasOwn(LAYOUT_VERSION, layout.mode)) continue;
    const path = layoutPath(type, layout.mode);
    // The first layout of a type and mode is the one written; a later one is reported.
    if (compared.has(path)) continue;
    compared.add(path);
    layoutFiles.delete(path);
    const version = LAYOUT_VERSION[layout.mode];
    const file = app[path];
    if (file !== undefined && (!isRecord(file) || file['version'] !== version)) {
      findings.push(
        `${path}: it is not version ${version}, which the app reads in ${layout.mode} mode`,
      );
    }
    const shown = layoutFields(file);
    const form = layout.mode === 'edit' || layout.mode === 'create';
    const expected = new Set<string>();
    const conditional = new Set(
      layout.fields.filter((field) => field.condition !== null).map((field) => field.binding),
    );
    const seen = new Set<string>();
    layout.fields.forEach((field, index) => {
      const id = `layout-field:${layout.path}#${index + 1}`;
      const binding = field.binding;
      if (field.element === 'nuxeo-document-viewer') return;
      if (binding === null || !XPATH.test(binding) || seen.has(binding)) return;
      // Shown once a field shows it: a field under a condition, or of an element the catalogue
      // does not know, leaves the next one binding the same property to show it.
      if (field.condition !== null) return;
      const choice = fieldWidget(catalogue, field.element, field.attributes);
      if (choice === null) return;
      seen.add(binding);
      const matches = shown.filter((candidate) => candidate.field === binding);
      if (layout.mode === 'metadata' && PANEL_ROWS.has(binding)) {
        if (matches.length > 0)
          findings.push(`${path}: it lists ${binding}, which the Properties panel already shows`);
        return;
      }
      expected.add(binding);
      if (matches.length === 0) {
        if (!excused(id))
          findings.push(
            `${path}: ${binding} is missing, though Web UI's ${layout.mode} layout of ${type} shows it`,
          );
        return;
      }
      if (matches.length > 1)
        findings.push(`${path}: it shows ${binding} ${matches.length} times, not once`);
      const [match] = matches;
      const want = choice.widget;
      if (version === 1) {
        if (isRecord(match.entry) && 'widget' in match.entry)
          findings.push(
            `${path}: ${match.at} names a widget, which version 1 cannot do and ignores`,
          );
        if (want !== null && !VERSION_ONE_WIDGETS.has(want) && !excused(id))
          findings.push(
            `${path}: ${binding} shows as its schema type picks, not as ${want}, and the report does not say so`,
          );
      } else {
        const actual = widgetOf(match.entry);
        if (actual !== want)
          findings.push(
            `${path}: ${binding} shows as ${describe(actual)}, not as ${describe(want)}`,
          );
        else if (!sameJson(parametersOf(match.entry), choice.parameters ?? {}))
          findings.push(
            `${path}: ${binding}'s ${want} widget has the parameters ${JSON.stringify(parametersOf(match.entry))}, not ${JSON.stringify(choice.parameters ?? {})}`,
          );
      }
      const required = isRecord(match.entry) && match.entry['required'] === true;
      if (form && required !== field.required)
        findings.push(
          `${path}: ${binding} is ${required ? '' : 'not '}required, but Web UI's is ${field.required ? '' : 'not '}required`,
        );
    });
    for (const field of shown) {
      if (field.field === null) {
        findings.push(`${path}: ${field.at} shows no property`);
      } else if (!expected.has(field.field) && !conditional.has(field.field)) {
        findings.push(`${path}: it shows ${field.field}, which Web UI's layout does not`);
      }
    }
  }
  for (const path of layoutFiles)
    findings.push(`${path}: the package has no Web UI layout of that type and mode`);

  // Lists: each queue against the one list that owns its path, a search screen's results or a
  // dashboard card's list, as the converter decides it. A list under a condition owns none: it is
  // check 5's. A card's missing queue is check 7's.
  for (const [path, owner] of queueOwners(inventory)) {
    if (owner.kind === 'card') {
      if (app[path] !== undefined)
        findings.push(
          ...compareColumns(
            path,
            owner.card.columns.filter((column) => column.field !== null),
            app[path],
          ),
        );
      continue;
    }
    const { search } = owner;
    if (app[path] === undefined) {
      if (!excused(`search:${search.path}#search`))
        findings.push(
          `${path} is missing, though Web UI's results of ${search.provider} show a list`,
        );
      continue;
    }
    // A column under a condition is check 5's, whether the queue shows it or not.
    const columns = search.columnDetails.filter(
      (column, index) =>
        column.field !== null &&
        !column.conditional &&
        !excused(`search-column:${search.path}#${index + 1}`),
    );
    // A property a column in no condition also shows is that column's, and held to it here.
    const always = new Set(columns.map((column) => column.field));
    const conditional = new Set(
      search.columnDetails
        .filter((column) => column.conditional && !always.has(column.field))
        .map((column) => column.field),
    );
    findings.push(...compareColumns(path, columns, app[path], conditional));
  }
  return { findings };
}

/** A list's columns against Web UI's, in order, each with its widget. */
function compareColumns(
  path: string,
  expected: readonly ResultColumn[],
  file: unknown,
  conditional: ReadonlySet<string | null> = new Set(),
): string[] {
  const findings: string[] = [];
  const shown = listColumns(file).filter((column) => !conditional.has(column.field));
  const want = expected.map((column) => ({ field: column.field, widget: columnWidget(column) }));
  const have = shown.map((column) => ({ field: column.field, widget: widgetOf(column.entry) }));
  for (const column of want)
    if (!have.some((candidate) => candidate.field === column.field))
      findings.push(`${path}: the column ${column.field} is missing`);
  for (const column of have)
    if (!want.some((candidate) => candidate.field === column.field))
      findings.push(
        `${path}: it has a column ${column.field ?? 'with no property'}, which Web UI's list does not`,
      );
  const order = (
    list: readonly { field: string | null }[],
    other: readonly { field: string | null }[],
  ) =>
    list
      .filter((column) => other.some((candidate) => candidate.field === column.field))
      .map((column) => column.field);
  if (!sameJson(order(want, have), order(have, want)))
    findings.push(
      `${path}: its columns are in the order ${order(have, want).join(', ')}, not ${order(want, have).join(', ')}`,
    );
  for (const column of want) {
    const match = have.find((candidate) => candidate.field === column.field);
    if (match && match.widget !== column.widget)
      findings.push(
        `${path}: the column ${column.field} shows as ${describe(match.widget)}, not as ${describe(column.widget)}`,
      );
  }
  return findings;
}

function describe(widget: string | null): string {
  return widget === null ? 'its schema type picks' : widget;
}
