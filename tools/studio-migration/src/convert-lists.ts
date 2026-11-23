/**
 * M1's conversion of lists: a search screen's results, and a dashboard card's list, each become a
 * queue, `queues/<id>.json`, over the same page provider (app-definition-v2.md, section 4).
 *
 * - **A queue has no search form.** It lists what its page provider returns with the form's
 *   predicates left empty, as Web UI's results do before anyone searches. The form and its fields
 *   are reported: letting a person fill them in needs a form the queue does not have yet.
 * - **A queue is a table.** A grid of thumbnails or a justified grid is reported.
 * - **What shows under a condition** waits for M2, as a layout's field does: a column in a
 *   condition is left out, and a table in one leaves the whole list pending.
 * - **A dashboard card** whose list becomes a queue is a card of `home.json`, naming the queue
 *   (`convert-home.ts`). The tasks and recently viewed cards wait: `home.json` has no card for
 *   either yet.
 */
import { own } from './catalogue';
import type { ConvertContext } from './convert';
import type { DashboardCard, Inventory, ResultColumn, SearchLayout } from './inventory';
import {
  homeQueueId,
  labelOf,
  slug,
  PAGE_SIZE_LIMIT,
  queuePageSize,
  queuePath,
  searchQueueId,
} from './app-files';
import { homeCards } from './convert-home';
import { columnWidget } from './widgets';

/** A column, as a queue writes it: the property alone, or with its heading and widget. */
export function queueColumn(column: ResultColumn): unknown {
  const label = labelOf(column.name);
  const widget = columnWidget(column);
  if (widget === null && Object.keys(label).length === 0) return column.field;
  return { field: column.field, ...label, ...(widget !== null ? { widget } : {}) };
}

/** The sort Web UI's results open with: the option marked selected, if any. */
export function openingSort(search: SearchLayout): { field: string; order: string }[] {
  const selected = search.sortOptions.find((option) => option.selected);
  return selected ? [{ field: selected.field, order: selected.order }] : [];
}

/**
 * What a card's `params` asks the page provider for, as a queue's positional parameters, or why
 * it cannot. Web UI writes `{"queryParams": "/"}`, or a list for several.
 */
export function cardParameters(
  card: DashboardCard,
): { parameters: string[] } | { problem: string } {
  if (card.params === null || card.params.trim() === '') return { parameters: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(card.params);
  } catch {
    return { problem: `its page provider's params, ${card.params}, are not JSON` };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    return { problem: `its page provider's params, ${card.params}, are not an object` };
  const named = Object.keys(parsed).filter((key) => key !== 'queryParams');
  if (named.length > 0)
    return {
      problem: `its page provider takes named parameters (${named.join(', ')}), and a queue gives only positional ones`,
    };
  const query = (parsed as Record<string, unknown>)['queryParams'];
  const list = query === undefined ? [] : Array.isArray(query) ? query : [query];
  if (!list.every((value) => typeof value === 'string' && !/\[\[|\{\{/.test(value)))
    return {
      problem: 'its query parameters are bound to the page, and a queue takes literals only',
    };
  return { parameters: list as string[] };
}

export function convertSearches(context: ConvertContext): void {
  const { inventory } = context;
  const owners = queueOwners(inventory);
  for (const search of inventory.searches) {
    const id = `search:${search.path}#search`;
    if (search.part === 'form') {
      context.decide(id, {
        outcome: 'reported',
        note: 'A queue has no search form yet: it lists what its page provider returns with these predicates left empty, as Web UI does before anyone searches',
      });
      search.fields.forEach((field, index) =>
        context.decide(`search-field:${search.path}#${index + 1}`, {
          outcome: 'reported',
          note: `It fills the predicate ${field.binding ?? 'it names'}, and a queue has no form to fill it in${machineLabel(field.label)}`,
        }),
      );
      continue;
    }
    search.fields.forEach((_, index) =>
      context.decide(`search-field:${search.path}#${index + 1}`, {
        outcome: 'reported',
        note: 'A field in a results layout has no place in a queue',
      }),
    );
    const queueId = searchQueueId(search);
    const path = queuePath(queueId);
    const report = (note: string, outcome: 'reported' | 'pending' = 'reported'): void => {
      const which = outcome === 'reported' ? 'reported' : 'pending';
      context.decide(id, { outcome, note });
      search.columnDetails.forEach((_, index) =>
        context.decide(`search-column:${search.path}#${index + 1}`, {
          outcome,
          note: `Its results are ${which}`,
        }),
      );
      search.views.forEach((_, index) =>
        context.decide(`search-view:${search.path}#${index + 1}`, {
          outcome,
          note: `Its results are ${which}`,
        }),
      );
    };
    if (search.provider === null) {
      report('It names no page provider, through a @search annotation or its form');
      continue;
    }
    if (isConditionalTable(search)) {
      report(
        `Its table shows only while a condition passes. M2 converts the condition, with truth tables, so the list is not shown to everyone meanwhile`,
        'pending',
      );
      continue;
    }
    const columns: unknown[] = [];
    search.columnDetails.forEach((column, index) => {
      const columnId = `search-column:${search.path}#${index + 1}`;
      if (column.conditional) {
        context.decide(columnId, {
          outcome: 'pending',
          note: 'It shows only while a condition passes. M2 converts the condition, with truth tables, so the column is not shown to everyone meanwhile',
        });
        return;
      }
      if (column.field === null) {
        context.decide(columnId, {
          outcome: 'reported',
          note: 'It shows no property a queue can name',
        });
        return;
      }
      columns.push(queueColumn(column));
      context.decide(columnId, { outcome: 'converted', to: path });
    });
    search.views.forEach((view, index) =>
      context.decide(
        `search-view:${search.path}#${index + 1}`,
        view === 'nuxeo-data-table'
          ? { outcome: 'converted', to: path }
          : {
              outcome: 'reported',
              note: 'A queue shows its records as a table: queue version 2 has no grid view (app-definition-v2.md, section 4)',
            },
      ),
    );
    // A queue needs at least one column (app-definition-v2.md, section 4).
    if (columns.length === 0) {
      const waiting = search.columnDetails.some((column) => column.conditional);
      context.decide(id, {
        outcome: waiting ? 'pending' : 'reported',
        note: waiting
          ? 'Every column it can show is under a condition, which M2 converts, and a queue needs at least one'
          : 'None of its columns shows a property a queue can name, and a queue needs at least one',
      });
      search.views.forEach((_, index) =>
        context.decide(`search-view:${search.path}#${index + 1}`, {
          outcome: waiting ? 'pending' : 'reported',
          note: `Its results are ${waiting ? 'pending' : 'reported'}`,
        }),
      );
      continue;
    }
    const owner = owners.get(path);
    if (owner?.kind !== 'search' || owner.search !== search) {
      report(`Another list is already written as ${path}`);
      continue;
    }
    const sort = openingSort(search);
    // A queue needs a name: the menu's, or else its page provider's.
    const named = labelOf(menuLabel(context, search));
    context.files[path] = {
      version: 2,
      ...(Object.keys(named).length > 0 ? named : { label: search.provider }),
      pageProvider: search.provider,
      ...(columns.length > 0 ? { columns } : {}),
      ...(sort.length > 0 ? { sort } : {}),
    };
    context.decide(id, { outcome: 'converted', to: path });
  }
}

/** A list a queue is written for: a search screen's results, or a dashboard card's list. */
export type QueueOwner =
  | { readonly kind: 'search'; readonly search: SearchLayout }
  | {
      readonly kind: 'card';
      readonly card: DashboardCard;
      /** Its place on the dashboard, from 0. */
      readonly index: number;
      readonly parameters: readonly string[];
    };

/**
 * Whose each queue is: for each path, the first list, search screens before dashboard cards, that
 * the converter writes a queue for at all. A list under a condition, with no column a queue can
 * show, with parameters a queue cannot send, or with no page provider owns no path, so a later
 * list of the same path may take it. The converter writes the owners' queues and reports every
 * other list of an owned path; checks 2, 5, 6 and 7 hold each queue to its owner, and to no other.
 */
export function queueOwners(inventory: Inventory): Map<string, QueueOwner> {
  const owners = new Map<string, QueueOwner>();
  for (const search of inventory.searches) {
    if (search.part !== 'results' || search.provider === null || isConditionalTable(search))
      continue;
    if (!search.columnDetails.some((column) => column.field !== null && !column.conditional))
      continue;
    const path = queuePath(searchQueueId(search));
    if (!owners.has(path)) owners.set(path, { kind: 'search', search });
  }
  inventory.dashboard?.cards.forEach((card, index) => {
    if (!isListCard(card) || !card.columns.some((column) => column.field !== null)) return;
    const parameters = cardParameters(card);
    if ('problem' in parameters) return;
    const path = queuePath(homeQueueId(card, index));
    if (!owners.has(path))
      owners.set(path, { kind: 'card', card, index, parameters: parameters.parameters });
  });
  return owners;
}

/** True when the results' table sits in a condition: the whole list then shows only to some. */
export function isConditionalTable(search: SearchLayout): boolean {
  return search.views.some(
    (view, index) => view === 'nuxeo-data-table' && search.conditionalViews[index] === true,
  );
}

/**
 * The label of the drawer entry that opens a search screen: Studio pairs a `DRAWER_ITEMS` entry
 * and the `DRAWER_PAGES` page holding the screen's `nuxeo-search-form` by their shared name.
 */
export function menuLabel(
  context: Pick<ConvertContext, 'inventory'>,
  search: SearchLayout,
): string | null {
  const contributions = context.inventory.slotContributions;
  const page = contributions.find((contribution) => {
    if (contribution.slot !== 'DRAWER_PAGES') return false;
    const form = contribution.parts.find((part) => part.element === 'nuxeo-search-form');
    return form !== undefined && searchOfForm(context.inventory, form.attributes) === search;
  });
  if (!page) return null;
  const item = contributions.find(
    (contribution) => contribution.slot === 'DRAWER_ITEMS' && contribution.name === page.name,
  );
  const icon = item?.parts.find((part) => part.element === 'nuxeo-menu-icon');
  return (icon && own(icon.attributes, 'label')) ?? null;
}

/**
 * The search screen's results a `nuxeo-search-form` opens: the one its `search-name` names, by
 * the screen's folder; only for a form that names none, the first on its `provider`. Two screens
 * can search one page provider, and a provider alone would take the first for both.
 */
export function searchOfForm(
  inventory: Pick<Inventory, 'searches'>,
  form: Readonly<Record<string, string>>,
): SearchLayout | undefined {
  const results = inventory.searches.filter((search) => search.part === 'results');
  const name = own(form, 'search-name')?.trim();
  if (name) return results.find((search) => searchQueueId(search) === slug(name));
  const provider = own(form, 'provider')?.trim();
  return provider ? results.find((search) => search.provider === provider) : undefined;
}

function machineLabel(label: string | null): string {
  // Studio's generated labels read a field's path back as words: "Hfs Fields Hfs S Object Id".
  return label && /\s{2}|\b[A-Z]\b/.test(label)
    ? `. Its label, "${label.replace(/\s+/g, ' ').trim()}", is machine-generated: an agent proposes a tidy one when it moves`
    : '';
}

/**
 * True when a card's list becomes a queue: a page provider's list, in no condition, fed by no
 * operation, and not the tasks or recently viewed card. Check 7 asks for a queue for these and no
 * other card.
 */
export function isListCard(card: DashboardCard): boolean {
  return (
    card.repeatOf === null &&
    !card.conditional &&
    card.operation === null &&
    !card.elements.includes('nuxeo-tasks-list') &&
    !card.elements.includes('nuxeo-document-storage') &&
    card.provider !== null
  );
}

export function convertDashboard(context: ConvertContext): void {
  const dashboard = context.inventory.dashboard;
  if (!dashboard) return;
  const owners = queueOwners(context.inventory);
  const cards = homeCards(context.inventory);
  dashboard.cards.forEach((card, index) => {
    const id = `dashboard-card:${dashboard.path}#${index + 1}`;
    if (card.repeatOf !== null) {
      context.decide(id, {
        outcome: 'reported',
        note: `It repeats card ${card.repeatOf + 1}, and is kept once`,
      });
      return;
    }
    if (card.conditional) {
      context.decide(id, {
        outcome: 'pending',
        note: 'It shows only while a condition passes: M2 converts the condition, with truth tables',
      });
      return;
    }
    if (card.operation !== null) {
      context.decide(id, {
        outcome: 'proposed',
        note: `Its list comes from the operation ${card.operation}. An agent proposes the page provider that gives the same documents, such as the favourites collection read with default_content_collection for Favorite.Fetch`,
      });
      return;
    }
    if (card.elements.includes('nuxeo-tasks-list')) {
      context.decide(id, {
        outcome: 'pending',
        note: "A card of the user's tasks: home.json has no card for them yet (app-definition-v2.md, section 10)",
      });
      return;
    }
    if (card.elements.includes('nuxeo-document-storage')) {
      context.decide(id, {
        outcome: 'pending',
        note: 'A card of recently viewed documents: home.json has no card for them yet (app-definition-v2.md, section 10)',
      });
      return;
    }
    if (!isListCard(card) || card.provider === null) {
      context.decide(id, { outcome: 'reported', note: 'It holds no list of a page provider' });
      return;
    }
    const parameters = cardParameters(card);
    if ('problem' in parameters) {
      context.decide(id, {
        outcome: 'reported',
        note: `It cannot be a queue: ${parameters.problem}`,
      });
      return;
    }
    const path = queuePath(homeQueueId(card, index));
    const columns = card.columns.filter((column) => column.field !== null).map(queueColumn);
    if (columns.length === 0) {
      context.decide(id, {
        outcome: 'reported',
        note: 'Its list shows no column a queue can name, and a queue needs at least one',
      });
      return;
    }
    const owner = owners.get(path);
    if (owner?.kind !== 'card' || owner.card !== card) {
      context.decide(id, {
        outcome: 'reported',
        note: `Another list is already written as ${path}`,
      });
      return;
    }
    const pageSize = queuePageSize(card);
    const label = labelOf(card.heading);
    context.files[path] = {
      version: 2,
      ...(Object.keys(label).length > 0 ? label : { label: card.provider }),
      pageProvider: card.provider,
      ...(parameters.parameters.length > 0 ? { parameters: parameters.parameters } : {}),
      ...(columns.length > 0 ? { columns } : {}),
      ...(pageSize !== null ? { pageSize } : {}),
    };
    const home = cards.find((candidate) => candidate.index === index);
    context.decide(id, {
      outcome: 'converted',
      to: `home.json ${home?.id ?? `card-${index + 1}`}, its list in ${path}`,
      ...(card.pageSize !== null && pageSize === null
        ? {
            note: `Its page size, ${card.pageSize}, is not one a queue takes (1 to ${PAGE_SIZE_LIMIT}), so the queue asks for its own`,
          }
        : {}),
    });
  });
  if (cards.length > 0)
    context.files['home.json'] = { version: 2, cards: cards.map((c) => c.entry) };
}
