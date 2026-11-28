/**
 * Check 2, fields (docs/business-apps/studio-migration.md, section 6): each converted layout shows
 * the fields its Web UI layout binds, in the same mode, with the same required flags and the
 * widgets layout-v2.md, section 10, expects; and each list shows its columns, in order, with
 * theirs. M2 adds the fields of the layout blocks a layout uses, each tab of a type's page, which
 * shows its block's fields, and each task form, which shows its task layout's variables.
 *
 * What Web UI shows is read from the package, field by field, less the repeats and the fields
 * that sit in a condition, which check 5 holds. The report is read only to excuse a field that
 * is missing: one it reports or leaves pending, with its reason, is accounted for, and blocks
 * readiness instead.
 */
import { isRecord } from '@agentic-ui/shared/app-definition';
import { listColumns, parametersOf, sameJson, widgetOf } from './app-walk';
import { layoutCards } from './blocks';
import { PANEL_ROWS } from './convert-layouts';
import { columnPlans, queueOwners, type ColumnPlan } from './convert-lists';
import { formPlaces, shownIn, tabOf } from './forms';
import type { CheckOutcome, HarnessInput } from './harness';
import type { ResultColumn } from './inventory';
import { ALWAYS, VERSION_ONE_WIDGETS, columnWidget, fieldWidget } from './widgets';

/** A property, `<prefix>:<name>`, or a variable of a task, `var:<name>`. */
const FIELD = /^[A-Za-z_][\w-]*:[A-Za-z_][\w-]*$/;

export function checkFields({ pkg, inventory, catalogue, conversion }: HarnessInput): CheckOutcome {
  const findings: string[] = [];
  const app = conversion.app;
  const entries = new Map((conversion.report.constructs ?? []).map((entry) => [entry.id, entry]));
  /** True when the report accounts for a construct some other way than converting it. */
  const excused = (id: string): boolean => {
    const entry = entries.get(id);
    return entry !== undefined && entry.outcome !== 'converted' && Boolean(entry.note?.trim());
  };
  const formFiles = new Set(
    Object.keys(app).filter((path) => path.startsWith('layouts/') || path.startsWith('tasks/')),
  );
  const versioned = new Set<string>();
  const places = formPlaces(pkg, inventory);

  for (const place of places) {
    const { path, options } = place;
    formFiles.delete(path);
    const version = options.version;
    const file = app[path];
    if (!versioned.has(path)) {
      versioned.add(path);
      if (file !== undefined && (!isRecord(file) || file['version'] !== version))
        findings.push(
          `${path}: it is not version ${version}, which the app reads in ${options.mode} mode`,
        );
    }
    const shown = shownIn(file, place.tab);
    const where = place.tab === null || place.tab === 'view' ? '' : ` tab ${place.tab}`;
    const expected = new Set<string>();
    const { cards, fields } = layoutCards(inventory, place.source);
    // A field that shows only while a condition passes is check 5's: its own, or its block's.
    const conditional = (field: (typeof fields)[number]): boolean =>
      field.field.condition !== null ||
      (!options.inTab && (cards[field.card].use?.conditions.length ?? 0) > 0);
    const hidden = new Set(fields.filter(conditional).map((field) => field.field.binding));
    const seen = new Set<string>();
    for (const placedField of fields) {
      const { field, id } = placedField;
      const binding = field.binding;
      if (field.element === 'nuxeo-document-viewer') continue;
      if (binding === null || !FIELD.test(binding) || seen.has(binding)) continue;
      // A block not given the document shows nothing of its own.
      const use = cards[placedField.card].use;
      if (use !== null && !use.document) continue;
      // Shown once a field shows it: a field under a condition, or of an element the catalogue
      // does not know, leaves the next one binding the same property to show it.
      if (conditional(placedField)) continue;
      const choice = fieldWidget(catalogue, field.element, field.attributes);
      if (choice === null) continue;
      seen.add(binding);
      const matches = shown.filter((candidate) => candidate.field === binding);
      if (options.mode === 'metadata' && PANEL_ROWS.has(binding)) {
        if (matches.length > 0)
          findings.push(`${path}: it lists ${binding}, which the Properties panel already shows`);
        continue;
      }
      expected.add(binding);
      if (matches.length === 0) {
        if (!excused(id))
          findings.push(`${path}${where}: ${binding} is missing, though ${place.what} shows it`);
        continue;
      }
      if (matches.length > 1)
        findings.push(`${path}${where}: it shows ${binding} ${matches.length} times, not once`);
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
            `${path}${where}: ${binding} shows as ${describe(actual)}, not as ${describe(want)}`,
          );
        else if (!sameJson(parametersOf(match.entry), choice.parameters ?? {}))
          findings.push(
            `${path}${where}: ${binding}'s ${want} widget has the parameters ${JSON.stringify(parametersOf(match.entry))}, not ${JSON.stringify(choice.parameters ?? {})}`,
          );
      }
      // In a form, a field Web UI only shows, bound one way, is read-only, and one it edits is
      // not. A task form shows the record's own properties read-only whatever its file says.
      const readOnly = isRecord(match.entry) && match.entry['readOnlyWhen'] === ALWAYS;
      const record = options.task === true && !binding.startsWith('var:');
      // Every form is version 2 (`LAYOUT_VERSION`), which can say read-only: version 1 is the
      // Properties panel's alone, which edits nothing.
      if (options.form && version === 2 && !record && readOnly === field.edits)
        findings.push(
          `${path}${where}: ${binding} is ${readOnly ? 'read-only' : 'editable'}, but Web UI's ${field.element} ${readOnly ? 'edits' : 'only shows'} it`,
        );
      const required = isRecord(match.entry) && match.entry['required'] === true;
      // A task form can require only its variables; the report says when Web UI required more.
      if (options.form && record && field.required && !excused(id))
        findings.push(
          `${path}${where}: ${binding} is required in Web UI, which a task form cannot say of the record's property, and the report does not say so`,
        );
      if (options.form && !record && required !== field.required)
        findings.push(
          `${path}${where}: ${binding} is ${required ? '' : 'not '}required, but Web UI's is ${field.required ? '' : 'not '}required`,
        );
    }
    for (const field of shown) {
      if (field.field === null) {
        findings.push(`${path}: ${field.at} shows no property`);
      } else if (!expected.has(field.field) && !hidden.has(field.field)) {
        findings.push(`${path}${where}: it shows ${field.field}, which ${place.what} does not`);
      }
    }
  }
  // A tab whose page is a list: its one card of related records, with the list's columns.
  for (const place of places) {
    const listing = place.tabPlan?.listing;
    const file = app[place.path];
    if (!listing || !place.tabPlan || file === undefined) continue;
    const tab = tabOf(file, place.tabPlan.id);
    const what = `Web UI's tab ${place.tabPlan.name}, which lists ${listing.provider}`;
    if (!tab) {
      findings.push(`${place.path}: its tab ${place.tabPlan.id} is missing, though ${what}`);
      continue;
    }
    const cards = Array.isArray(tab.tab['cards']) ? tab.tab['cards'] : [];
    const card = cards.find((item) => isRecord(item) && item['id'] === listing.cardId);
    for (const other of cards)
      if (other !== card)
        findings.push(
          `${place.path} tab ${place.tabPlan.id}: it shows the card ${String(isRecord(other) ? other['id'] : other)}, which ${what} does not`,
        );
    if (!isRecord(card) || !isRecord(card['related'])) {
      findings.push(
        `${place.path} tab ${place.tabPlan.id}: its card of related records ${listing.cardId} is missing, though ${what}`,
      );
      continue;
    }
    findings.push(
      ...compareColumns(
        `${place.path} tab ${place.tabPlan.id}`,
        listing.columns.filter((_, index) => listing.plans[index].kind === 'write'),
        card['related'],
        leftOut(listing.columns, listing.plans),
      ),
    );
  }
  // A tab no tab of the package gives.
  for (const path of versioned) {
    const file = app[path];
    const tabs = isRecord(file) && Array.isArray(file['tabs']) ? file['tabs'] : [];
    for (const tab of tabs) {
      const id = isRecord(tab) ? tab['id'] : undefined;
      if (!places.some((place) => place.path === path && place.tab === id))
        findings.push(`${path}: it has a tab ${String(id)}, which no tab of the package gives`);
    }
  }
  for (const path of formFiles)
    findings.push(
      path.startsWith('tasks/')
        ? `${path}: the package has no task layout of that workflow and step`
        : `${path}: the package has no Web UI layout of that type and mode`,
    );

  // Lists: each queue against the one list that owns its path, a search screen's results or a
  // dashboard card's list, as the converter decides it. A list under a condition owns none: it is
  // check 5's. A card's missing queue is check 7's.
  for (const [path, owner] of queueOwners(inventory)) {
    if (owner.kind === 'card') {
      if (app[path] !== undefined) {
        const columns = owner.card.columns;
        const plans = columnPlans(inventory, inventory.dashboard?.path ?? '', columns, false);
        findings.push(
          ...compareColumns(
            path,
            columns.filter((_, index) => plans[index].kind === 'write'),
            app[path],
            leftOut(columns, plans),
          ),
        );
      }
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
    // Each column written, a column under a condition with its rule among them, in Web UI's
    // order; one left out under a condition is check 5's, whether the queue shows it or not.
    const plans = columnPlans(inventory, search.path, search.columnDetails, false);
    const columns = search.columnDetails.filter(
      (_, index) =>
        plans[index].kind === 'write' && !excused(`search-column:${search.path}#${index + 1}`),
    );
    findings.push(
      ...compareColumns(path, columns, app[path], leftOut(search.columnDetails, plans)),
    );
  }
  return { findings };
}

/**
 * The properties of a list's columns under a condition that are not written, and that no column
 * written shows: what the list must not show, which check 5 holds, and check 2 leaves to it.
 */
export function leftOut(
  columns: readonly ResultColumn[],
  plans: readonly ColumnPlan[],
): Set<string | null> {
  const written = new Set(
    columns.filter((_, index) => plans[index].kind === 'write').map((column) => column.field),
  );
  return new Set(
    columns
      .filter(
        (column, index) =>
          column.conditional && plans[index].kind === 'skip' && !written.has(column.field),
      )
      .map((column) => column.field),
  );
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
