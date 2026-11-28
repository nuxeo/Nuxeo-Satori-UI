/**
 * M1's conversion of lists: a search screen's results, and a dashboard card's list, each become a
 * queue, `queues/<id>.json`, over the same page provider (app-definition-v2.md, section 4).
 *
 * - **A queue has no search form.** It lists what its page provider returns with the form's
 *   predicates left empty, as Web UI's results do before anyone searches. The form and its fields
 *   are reported: letting a person fill them in needs a form the queue does not have yet.
 * - **A queue is a table.** A grid of thumbnails or a justified grid is reported.
 * - **What shows under a condition.** A dashboard card under a rule on the user carries it, and so
 *   does its queue (`guards.ts`); one whose rule reads a document is reported, as no record is
 *   open on the home. A column in a condition its table is not in is left out: reported for a
 *   search screen, and named in a card's note. A search screen's table in one gets no queue and is
 *   reported. M2 converts no condition there, and none shows to everyone meanwhile.
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
import { carry, guardOfSet, type Guard } from './guards';
import { columnWidget } from './widgets';

/** A column, as a queue writes it: the property alone, or with its heading and widget. */
export function queueColumn(column: ResultColumn): unknown {
  const label = labelOf(column.name);
  const widget = columnWidget(column);
  if (widget === null && Object.keys(label).length === 0) return column.field;
  return { field: column.field, ...label, ...(widget !== null ? { widget } : {}) };
}

/** How one column of a list is written, or why it is not. */
export type ColumnPlan =
  | {
      readonly kind: 'write';
      readonly field: string;
      readonly entry: unknown;
      /** The conditions it shows under, whose rule is its `visibleWhen`; absent for none. */
      readonly guard?: Extract<Guard, { kind: 'rule' }>;
    }
  | {
      readonly kind: 'skip';
      readonly outcome: 'reported' | 'proposed';
      readonly note: string;
    };

/**
 * How each column of a list is written, in order (docs/business-apps/studio-migration.md, section
 * 3): one in no condition of its own as Web UI shows it, and one under a condition with the rule of
 * what it shows under as its `visibleWhen` (app-definition-v2.md, section 4; layout-v2.md, section
 * 7), where the list can carry the rule: a queue has no open record, so there a rule that reads one
 * is reported, while a list of related records on a record page reads the open one (`record`).
 * A column with no property, one whose condition does not convert, and one whose property another
 * column shows to everyone are not written, and say why. Shared with checks 2, 5 and 6, which hold
 * the list to it.
 */
export function columnPlans(
  inventory: Inventory,
  path: string,
  columns: readonly ResultColumn[],
  record: boolean,
): ColumnPlan[] {
  const always = new Set(
    columns.filter((column) => column.field !== null && !column.conditional).map((c) => c.field),
  );
  return columns.map((column): ColumnPlan => {
    const field = column.field;
    if (field === null)
      return { kind: 'skip', outcome: 'reported', note: 'It shows no property a list can name' };
    if (!column.conditional) return { kind: 'write', field, entry: queueColumn(column) };
    if (always.has(field))
      return {
        kind: 'skip',
        outcome: 'reported',
        note: `It shows ${field} only while a condition passes, and another column of the list shows it to everyone: that one is kept`,
      };
    const guard = guardOfSet(inventory, path, column.conditions);
    if (guard.kind !== 'rule') return { kind: 'skip', outcome: guard.kind, note: guard.note };
    if (guard.document && !record)
      return {
        kind: 'skip',
        outcome: 'reported',
        note: 'It shows only while a condition on a document passes, and no record is open in a queue: it is left out rather than shown to everyone, for a person to decide',
      };
    if (guard.rule === 'core.true') return { kind: 'write', field, entry: queueColumn(column) };
    const written = queueColumn(column);
    return {
      kind: 'write',
      field,
      entry: {
        ...(typeof written === 'string' ? { field: written } : (written as object)),
        visibleWhen: guard.rule,
      },
      guard,
    };
  });
}

/**
 * The guard of a search screen's table: the condition it sits in, and those that one sits in. A
 * queue is one list, so a screen of several tables, one of them under a condition, is reported:
 * which of its columns shows to whom is a person's call.
 */
export function tableGuard(inventory: Inventory, search: SearchLayout): Guard {
  const tables = search.views.flatMap((view, index) =>
    view === 'nuxeo-data-table' ? [search.viewConditions[index] ?? []] : [],
  );
  const same = (a: readonly number[], b: readonly number[]): boolean =>
    a.length === b.length && a.every((index, at) => index === b[at]);
  if (tables.some((conditions) => !same(conditions, tables[0])))
    return {
      kind: 'reported',
      note: `Its results show ${tables.length} tables, not all of them in the same condition, and a queue is one list: which of their columns shows to whom is a person's call, and the list is not shown to everyone meanwhile`,
      conditions: [],
    };
  return guardOfSet(inventory, search.path, tables[0] ?? []);
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
    const report = (
      note: string,
      outcome: 'reported' | 'pending' | 'proposed' = 'reported',
    ): void => {
      context.decide(id, { outcome, note });
      search.columnDetails.forEach((_, index) =>
        context.decide(`search-column:${search.path}#${index + 1}`, {
          outcome,
          note: `Its results are ${outcome}`,
        }),
      );
      search.views.forEach((_, index) =>
        context.decide(`search-view:${search.path}#${index + 1}`, {
          outcome,
          note: `Its results are ${outcome}`,
        }),
      );
    };
    if (search.provider === null) {
      report('It names no page provider, through a @search annotation or its form');
      continue;
    }
    // A table under a condition: the queue shows to whom the table does, where its rule reads only
    // the user, as no record is open in a queue.
    const table = isConditionalTable(search) ? tableGuard(inventory, search) : null;
    if (table && table.kind !== 'rule') {
      report(table.note, table.kind);
      continue;
    }
    if (table?.kind === 'rule' && table.document) {
      report(
        'Its table shows only while a condition on a document passes, and no record is open in a queue: a person decides it, and the list is not shown to everyone meanwhile',
      );
      continue;
    }
    const plans = columnPlans(inventory, search.path, search.columnDetails, false);
    const columns: unknown[] = [];
    plans.forEach((plan, index) => {
      const columnId = `search-column:${search.path}#${index + 1}`;
      if (plan.kind === 'skip') {
        context.decide(columnId, { outcome: plan.outcome, note: plan.note });
        return;
      }
      columns.push(plan.entry);
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
      const waiting = plans.some((plan) => plan.kind === 'skip' && plan.outcome === 'proposed');
      const outcome = waiting ? 'proposed' : 'reported';
      context.decide(id, {
        outcome,
        note: waiting
          ? 'Every column it can show is under a condition whose rule is proposed, and a queue needs at least one: it is written once a person accepts one'
          : 'None of its columns can be written, each says why, and a queue needs at least one',
      });
      search.views.forEach((_, index) =>
        context.decide(`search-view:${search.path}#${index + 1}`, {
          outcome,
          note: `Its results are ${outcome}`,
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
    const rule = table?.kind === 'rule' && table.rule !== 'core.true' ? table.rule : null;
    context.files[path] = {
      version: 2,
      ...(Object.keys(named).length > 0 ? named : { label: search.provider }),
      pageProvider: search.provider,
      ...(columns.length > 0 ? { columns } : {}),
      ...(sort.length > 0 ? { sort } : {}),
      ...(rule !== null ? { visibleWhen: rule } : {}),
    };
    if (table) carry(context.carried, table, path);
    plans.forEach((plan) => {
      if (plan.kind === 'write' && plan.guard)
        carry(context.carried, plan.guard, `${path} ${plan.field}`);
    });
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
    if (search.part !== 'results' || search.provider === null) continue;
    // A table under a condition is a list too when its rule can travel to a queue, which reads the
    // user only.
    if (isConditionalTable(search)) {
      const guard = tableGuard(inventory, search);
      if (guard.kind !== 'rule' || guard.document) continue;
    }
    const plans = columnPlans(inventory, search.path, search.columnDetails, false);
    if (!plans.some((plan) => plan.kind === 'write')) continue;
    const path = queuePath(searchQueueId(search));
    if (!owners.has(path)) owners.set(path, { kind: 'search', search });
  }
  inventory.dashboard?.cards.forEach((card, index) => {
    if (!isListCard({ ...card, conditional: false })) return;
    const dashboardPath = inventory.dashboard?.path ?? '';
    if (
      !columnPlans(inventory, dashboardPath, card.columns, false).some(
        (plan) => plan.kind === 'write',
      )
    )
      return;
    // A card under a condition is a list too when its rule can travel to the home, which reads
    // the user only.
    if (card.conditional) {
      const guard = cardGuard(inventory, card);
      if (guard.kind !== 'rule' || guard.document) return;
    }
    const parameters = cardParameters(card);
    if ('problem' in parameters) return;
    const path = queuePath(homeQueueId(card, index));
    if (!owners.has(path))
      owners.set(path, { kind: 'card', card, index, parameters: parameters.parameters });
  });
  return owners;
}

/** The guard of a dashboard card: the conditions it sits in or holds, nested. */
export function cardGuard(inventory: Inventory, card: DashboardCard): Guard {
  return inventory.dashboard
    ? guardOfSet(inventory, inventory.dashboard.path, card.conditions)
    : { kind: 'rule', rule: 'core.true', document: false, conditions: [] };
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
    const guard = card.conditional ? cardGuard(context.inventory, card) : null;
    if (guard && guard.kind !== 'rule') {
      context.decide(id, { outcome: guard.kind, note: guard.note });
      return;
    }
    if (guard?.kind === 'rule' && guard.document) {
      context.decide(id, {
        outcome: 'reported',
        note: 'Its condition reads a document, and no record is open on the home',
      });
      return;
    }
    if (card.operation !== null) {
      // A proposal a person decides, though it proposes nothing the converter can write yet: no
      // queue takes the list an operation gives, so it can be rejected and not accepted.
      const verdict = context.verdicts.get(id);
      context.decide(id, {
        outcome: 'proposed',
        note: `Its list comes from the operation ${card.operation}. An agent proposes the page provider that gives the same documents, such as the favourites collection read with default_content_collection for Favorite.Fetch`,
        proposal: true,
        ...(verdict && !verdict.accepted ? { applied: 'reject' as const } : {}),
      });
      return;
    }
    const shows = cardShows(card);
    if (shows.length > 1) {
      const words = {
        list: 'a list of a page provider',
        tasks: "the person's tasks",
        recent: 'recently viewed documents',
      };
      context.decide(id, {
        outcome: 'reported',
        note: `It shows ${shows.map((kind) => words[kind]).join(' and ')}, and a card of home.json shows one thing: a person decides which, and nothing of it is written meanwhile`,
      });
      return;
    }
    if (isTasksCard(card)) {
      context.decide(id, {
        outcome: 'converted',
        to: `home.json ${homeCardId(index)}`,
        note: TASKS_NOTE,
      });
      return;
    }
    if (isRecentCard(card)) {
      // A proposal, not a conversion: home.json's recent lists another set of records than Web
      // UI's recently viewed card. Written only once a person accepts it.
      const verdict = card.verdict;
      context.decide(id, {
        outcome: 'proposed',
        note: RECENT_NOTE,
        proposal: true,
        proposes: recentCardEntry(card, index, guard),
        ...(verdict
          ? { applied: verdict.accepted ? ('accept' as const) : ('reject' as const) }
          : {}),
        ...(verdict?.accepted ? { to: `home.json ${homeCardId(index)}` } : {}),
      });
      return;
    }
    if (!isListCard({ ...card, conditional: false }) || card.provider === null) {
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
    // A column under a condition carries its rule, which on the home reads the user only; one
    // that cannot carry it is left out, never shown to everyone, and the card says so.
    const plans = columnPlans(context.inventory, dashboard.path, card.columns, false);
    const columns = plans.flatMap((plan) => (plan.kind === 'write' ? [plan.entry] : []));
    const left = plans.flatMap((plan, position) =>
      plan.kind === 'skip'
        ? [
            `its column ${position + 1}${card.columns[position].field ? `, ${card.columns[position].field},` : ''} is left out: ${plan.note}`,
          ]
        : [],
    );
    if (columns.length === 0) {
      context.decide(id, {
        outcome: plans.some((plan) => plan.kind === 'skip' && plan.outcome === 'proposed')
          ? 'proposed'
          : 'reported',
        note: `Its list shows no column a queue can write, and a queue needs at least one: ${left.join('; ')}`,
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
      // The queue a card under a condition opens shows to whom the card does.
      ...(guard?.kind === 'rule' && guard.rule !== 'core.true' ? { visibleWhen: guard.rule } : {}),
    };
    plans.forEach((plan) => {
      if (plan.kind === 'write' && plan.guard)
        carry(context.carried, plan.guard, `${path} ${plan.field}`);
    });
    const home = cards.find((candidate) => candidate.index === index);
    const to = `home.json ${home?.id ?? homeCardId(index)}, its list in ${path}`;
    const sized =
      card.pageSize !== null && pageSize === null
        ? `Its page size, ${card.pageSize}, is not one a queue takes (1 to ${PAGE_SIZE_LIMIT}), so the queue asks for its own`
        : null;
    // Written, but without what it cannot show as Web UI does: reported, for a person to decide.
    context.decide(
      id,
      left.length > 0
        ? {
            // What it leaves out only waits for a proposal: it follows that proposal, as a field does.
            outcome:
              !sized && plans.every((plan) => plan.kind === 'write' || plan.outcome === 'proposed')
                ? 'proposed'
                : 'reported',
            to,
            note: [`Written without what Web UI shows of it: ${left.join('; ')}`, sized]
              .filter(Boolean)
              .join('. '),
          }
        : { outcome: 'converted', to, ...(sized ? { note: sized } : {}) },
    );
  });
  if (cards.length > 0) {
    context.files['home.json'] = { version: 2, cards: cards.map((c) => c.entry) };
    for (const card of cards) {
      const source = dashboard.cards[card.index];
      if (!source.conditional) continue;
      const guard = cardGuard(context.inventory, source);
      carry(context.carried, guard, `home.json ${card.id}`);
      if (card.queue !== undefined) carry(context.carried, guard, `queues/${card.queue}.json`);
    }
  }
}

/** The id a dashboard card's card of `home.json` takes: `card-<n>`, by its place. */
export function homeCardId(index: number): string {
  return `card-${index + 1}`;
}

/** True for a card of the person's tasks, `nuxeo-tasks-list`, which `home.json`'s `tasks` lists. */
export function isTasksCard(card: DashboardCard): boolean {
  return card.repeatOf === null && card.operation === null && cardShows(card).join() === 'tasks';
}

/** True for Web UI's recently viewed card, read from the browser by `nuxeo-document-storage`. */
export function isRecentCard(card: DashboardCard): boolean {
  return card.repeatOf === null && card.operation === null && cardShows(card).join() === 'recent';
}

/**
 * What a dashboard card shows: a list of a page provider, the person's tasks, their recently viewed
 * documents. A card of `home.json` shows one thing, so a card that shows several is reported.
 */
export function cardShows(card: DashboardCard): ('list' | 'tasks' | 'recent')[] {
  return [
    ...(card.provider !== null ? (['list'] as const) : []),
    ...(card.elements.includes('nuxeo-tasks-list') ? (['tasks'] as const) : []),
    ...(card.elements.includes('nuxeo-document-storage') ? (['recent'] as const) : []),
  ];
}

export const TASKS_NOTE =
  "home.json's tasks card lists the person's open tasks of every workflow, the newest 5, with a link to the tasks page (app-definition-v2.md, section 10). Which of them Web UI's nuxeo-tasks-list shows, and how many at once, is its own, and not read from the package";

export const RECENT_NOTE =
  "Web UI's card lists the documents the person opened last, which Web UI keeps in their browser (nuxeo-document-storage). Nuxeo keeps no list of what a person opens, so home.json's recent card lists the records the person created or edited last instead (app-definition-v2.md, section 10): another list, which is why it is proposed rather than converted. Accepted, it is written as that card, its records shown with their type and the day each last changed, not with the columns of Web UI's table; rejected, it is written nowhere";

/**
 * The card of `home.json` a dashboard card of the person's tasks becomes: every workflow's tasks,
 * as `nuxeo-tasks-list` lists them, under the card's heading, shown to whom the card is.
 */
export function tasksCardEntry(
  card: DashboardCard,
  index: number,
  guard: Guard | null,
): Record<string, unknown> {
  return {
    id: homeCardId(index),
    ...labelOf(card.heading),
    tasks: {},
    ...(guard?.kind === 'rule' && guard.rule !== 'core.true' ? { visibleWhen: guard.rule } : {}),
  };
}

/**
 * The card of `home.json` proposed for Web UI's recently viewed card: the person's recent records,
 * of every type, under the card's heading, shown to whom the card is.
 */
export function recentCardEntry(
  card: DashboardCard,
  index: number,
  guard: Guard | null,
): Record<string, unknown> {
  return {
    id: homeCardId(index),
    ...labelOf(card.heading),
    recent: {},
    ...(guard?.kind === 'rule' && guard.rule !== 'core.true' ? { visibleWhen: guard.rule } : {}),
  };
}
