/**
 * Check 7, what the server is asked (docs/business-apps/studio-migration.md, section 6): buttons
 * and searches do the same thing in both apps.
 *
 * What each app is configured to ask for is in the package and the conversion, so that half runs
 * without a server:
 *
 * - **a list** asks the same page provider, with the same parameters, the same opening sort and,
 *   for a dashboard card, the same page size;
 * - **an action** runs the same operation, with the same parameters;
 * - **the home and the menu** open the same lists as Web UI's dashboard and left menu, each card
 *   and entry once, and ask for no KPI;
 * - **nothing is asked that Web UI does not ask:** every queue and action comes from the package.
 *
 * Recording the requests both apps send, and comparing the result counts once search has caught up
 * with recent writes, needs the migration server: that half does not run here, and the check says
 * so. Lab mode records the requests of a document's page on a server (`lab.ts`); lists and buttons
 * are still to come.
 */
import { isRecord } from '@agentic-ui/shared/app-definition';
import { appIdOf, queuePageSize } from './app-files';
import { sameJson } from './app-walk';
import { recordedAllowList } from './convert';
import { homeCards, menuEntries, type HomeCard } from './convert-home';
import { homeCardId, isRecentCard, openingSort, queueOwners } from './convert-lists';
import { actionOwners } from './convert-slots';
import { formPlaces, tabOf } from './forms';
import type { CheckOutcome, HarnessInput } from './harness';

export function checkRequests({
  pkg,
  inventory,
  catalogue,
  conversion,
}: HarnessInput): CheckOutcome {
  const findings: string[] = [];
  const app = conversion.app;
  const expectedQueues = new Set<string>();
  const entries = new Map((conversion.report.constructs ?? []).map((entry) => [entry.id, entry]));

  const list = (
    path: string,
    provider: string,
    parameters: readonly string[],
    sort: unknown[],
    pageSize: number | null,
    missing?: string,
  ): void => {
    expectedQueues.add(path);
    const queue = app[path];
    if (!isRecord(queue)) {
      if (missing !== undefined) findings.push(missing);
      return;
    }
    if (queue['pageProvider'] !== provider)
      findings.push(
        `${path}: it asks the page provider ${JSON.stringify(queue['pageProvider'])}, where Web UI asks ${provider}`,
      );
    const asked = Array.isArray(queue['parameters']) ? queue['parameters'] : [];
    if (!sameJson(asked, parameters))
      findings.push(
        `${path}: it sends the parameters ${JSON.stringify(asked)}, where Web UI sends ${JSON.stringify(parameters)}`,
      );
    const sorted = Array.isArray(queue['sort']) ? queue['sort'] : [];
    if (!sameJson(sorted, sort))
      findings.push(
        `${path}: it sorts by ${JSON.stringify(sorted)}, where Web UI opens sorted by ${JSON.stringify(sort)}`,
      );
    if ((queue['pageSize'] ?? null) !== pageSize)
      findings.push(
        `${path}: it asks for pages of ${JSON.stringify(queue['pageSize'] ?? 10)}, where Web UI asks for ${pageSize ?? "the page provider's own size"}`,
      );
    findings.push(...offered(path, queue, "Web UI's list"));
  };

  // Each queue against the one list that owns its path, as the converter decides it, and no
  // other: a later list of the same path is reported, and one under a condition owns none.
  for (const [path, owner] of queueOwners(inventory)) {
    if (owner.kind === 'search') {
      // Web UI's form sends a predicate's parameter only once someone fills it in. A search
      // screen's missing queue is check 2's.
      list(path, owner.search.provider ?? '', [], openingSort(owner.search), null);
      continue;
    }
    const { card, index } = owner;
    // Web UI's data table asks a card's provider for its own page size, which a queue keeps when
    // it is one a queue takes. The card's queue must be there, unless the report reports the
    // card, with its reason.
    const entry = entries.get(`dashboard-card:${inventory.dashboard?.path}#${index + 1}`);
    const excused = entry?.outcome === 'reported' && Boolean(entry.note?.trim());
    list(
      path,
      card.provider ?? '',
      owner.parameters,
      [],
      queuePageSize(card),
      excused
        ? undefined
        : `${path} is missing, though Web UI's card ${index + 1} lists ${card.provider}`,
    );
  }
  for (const path of Object.keys(app))
    if (path.startsWith('queues/') && !expectedQueues.has(path))
      findings.push(`${path}: it asks for a list that no screen or card of the package asks for`);

  // A tab whose page is a list asks, as its card of related records, what Web UI's page asks: the
  // same page provider, with the same parameters, the open record among them where the page passes
  // it, the same opening sort and the same page size. A tab or a card missing is check 2's.
  const related = new Set<string>();
  for (const place of formPlaces(pkg, inventory)) {
    const listing = place.tabPlan?.listing;
    const tab = place.tabPlan;
    if (!listing || !tab) continue;
    const written = tabOf(app[place.path], tab.id);
    related.add(`${place.path} ${tab.id} ${listing.cardId}`);
    const cards = written && Array.isArray(written.tab['cards']) ? written.tab['cards'] : [];
    const card = cards.find((item) => isRecord(item) && item['id'] === listing.cardId);
    const asked = isRecord(card) && isRecord(card['related']) ? card['related'] : null;
    if (asked === null) continue;
    const where = `${place.path} tab ${tab.id}`;
    const source = `Web UI's tab ${tab.name}`;
    if (asked['pageProvider'] !== listing.provider)
      findings.push(
        `${where}: it asks the page provider ${JSON.stringify(asked['pageProvider'])}, where ${source} asks ${listing.provider}`,
      );
    const parameters = Array.isArray(asked['parameters']) ? asked['parameters'] : [];
    if (!sameJson(parameters, listing.parameters))
      findings.push(
        `${where}: it sends the parameters ${JSON.stringify(parameters)}, where ${source} sends ${JSON.stringify(listing.parameters)}`,
      );
    const sorted = Array.isArray(asked['sort']) ? asked['sort'] : [];
    if (!sameJson(sorted, listing.sort))
      findings.push(
        `${where}: it sorts by ${JSON.stringify(sorted)}, where ${source} opens sorted by ${JSON.stringify(listing.sort)}`,
      );
    if ((asked['pageSize'] ?? null) !== listing.pageSize)
      findings.push(
        `${where}: it asks for pages of ${JSON.stringify(asked['pageSize'] ?? 10)}, where ${source} asks for ${listing.pageSize ?? "the page provider's own size"}`,
      );
    findings.push(...offered(where, asked, source));
  }
  // Nothing else asks for related records: each such card is a tab's whose page is a list.
  for (const [path, file] of Object.entries(app)) {
    if (!path.startsWith('layouts/') || !isRecord(file)) continue;
    const holders: { tab: string | null; cards: unknown[] }[] = [
      { tab: null, cards: Array.isArray(file['cards']) ? file['cards'] : [] },
      ...(Array.isArray(file['tabs']) ? file['tabs'] : []).map((tab) => ({
        tab: isRecord(tab) && typeof tab['id'] === 'string' ? tab['id'] : null,
        cards: isRecord(tab) && Array.isArray(tab['cards']) ? tab['cards'] : [],
      })),
    ];
    for (const { tab, cards } of holders)
      for (const card of cards) {
        if (!isRecord(card) || !('related' in card)) continue;
        if (tab !== null && related.has(`${path} ${tab} ${String(card['id'])}`)) continue;
        const asked = isRecord(card['related']) ? card['related']['pageProvider'] : undefined;
        findings.push(
          `${path}: the card ${String(card['id'])} lists ${JSON.stringify(asked ?? null)} as related records, which no tab of the package lists`,
        );
      }
  }

  // The home and the menu open the same lists as Web UI's dashboard and left menu, and no other.
  findings.push(
    ...homeOpened(app['home.json'], homeCards(inventory), inventory),
    ...opened(
      'navigation.json',
      app['navigation.json'],
      'entries',
      menuEntries(inventory, catalogue).map((entry) => ({
        id: entry.id,
        queue: entry.queue,
        source: `Web UI's menu entry "${entry.item.name}"`,
      })),
      'no menu entry of the package opens',
    ),
  );

  const actions = app['actions.json'];
  const written = isRecord(actions) && Array.isArray(actions['actions']) ? actions['actions'] : [];
  // Each action is held to the button that owns its id: the first that becomes an action at all,
  // as the converter decides it, not merely the first to bear the name.
  const owners = actionOwners(inventory, catalogue, appIdOf(pkg), recordedAllowList(conversion));
  const expectedActions = new Set(owners.keys());
  for (const [id, button] of owners) {
    const { contribution, slot } = button;
    const action = written.find((candidate) => isRecord(candidate) && candidate['id'] === id);
    if (!isRecord(action)) {
      findings.push(
        `actions.json: ${id} is missing, though Web UI's "${contribution.name}" runs ${button.operation}`,
      );
      continue;
    }
    if (action['operation'] !== button.operation)
      findings.push(
        `actions.json: ${id} runs ${JSON.stringify(action['operation'])}, where Web UI's "${contribution.name}" runs ${button.operation}`,
      );
    const parameters = isRecord(action['parameters']) ? action['parameters'] : {};
    if (!sameJson(parameters, button.parameters ?? {}))
      findings.push(
        `actions.json: ${id} sends ${JSON.stringify(parameters)}, where Web UI sends ${JSON.stringify(button.parameters ?? {})}`,
      );
    const bulk = Array.isArray(action['on']) && action['on'].includes('bulk');
    if (bulk !== (slot === 'bulk-actions'))
      findings.push(
        `actions.json: ${id} runs on ${bulk ? 'a selection' : 'the open record'}, where Web UI's runs on ${slot === 'bulk-actions' ? 'a selection' : 'the open record'}`,
      );
  }
  for (const action of written) {
    const id = isRecord(action) ? action['id'] : undefined;
    if (typeof id !== 'string' || !expectedActions.has(id))
      findings.push(
        `actions.json: ${JSON.stringify(id)} runs something no button of the package runs`,
      );
  }

  return {
    findings,
    rest: 'Recording the requests both apps send, and comparing their result counts, needs the migration server',
  };
}

/**
 * The home's cards against those the package's dashboard gives (`homeCards`): each there once,
 * showing what its card shows, a link to the same queue, the person's tasks of every workflow, or,
 * once a person accepted it, their recent records of every type; no KPI, which Web UI's dashboard
 * never shows; and none besides. A card of recent records no one accepted is said to be.
 */
function homeOpened(
  content: unknown,
  expected: readonly HomeCard[],
  inventory: HarnessInput['inventory'],
): string[] {
  const findings: string[] = [];
  const file = 'home.json';
  const written = isRecord(content) && Array.isArray(content['cards']) ? content['cards'] : [];
  const shows = (card: HomeCard): string =>
    card.kind === 'queue'
      ? `opens queues/${card.queue}.json`
      : card.kind === 'tasks'
        ? "lists the person's tasks"
        : "is proposed as the person's recent records, which a person accepted";
  for (const want of expected) {
    const source = `Web UI's dashboard card ${want.index + 1}`;
    const matches = written.filter((item) => isRecord(item) && item['id'] === want.id);
    if (matches.length === 0) {
      findings.push(`${file}: ${want.id} is missing, though ${source} ${shows(want)}`);
      continue;
    }
    if (matches.length > 1)
      findings.push(`${file}: ${want.id} is there ${matches.length} times, not once`);
    const [item] = matches as Record<string, unknown>[];
    // Web UI's dashboard shows a list, never a figure: a KPI asks a page provider for a count
    // nothing in the package asks for.
    if ('kpi' in item)
      findings.push(`${file}: ${want.id} asks for a KPI, which ${source} does not show`);
    if (want.kind === 'queue') {
      if (item['queue'] !== want.queue)
        findings.push(
          `${file}: ${want.id} opens ${JSON.stringify(item['queue'] ?? item['page'] ?? null)}, where ${source} opens queues/${want.queue}.json`,
        );
      continue;
    }
    const list = item[want.kind];
    if (!isRecord(list)) {
      findings.push(
        `${file}: ${want.id} shows ${describeCard(item)}, where ${source} ${shows(want)}`,
      );
      continue;
    }
    // Every workflow's tasks, or every type's records, as many as home.json's own number: the
    // package names no workflow, type or number, and a person accepted the card as proposed.
    const expected = want.entry[want.kind];
    if (!sameJson(list, expected))
      findings.push(
        `${file}: ${want.id} lists them as ${JSON.stringify(list)}, where ${source} ${shows(want)}, as ${JSON.stringify(expected)}`,
      );
  }
  const dashboard = inventory.dashboard;
  for (const item of written) {
    const id = isRecord(item) ? item['id'] : undefined;
    if (expected.some((want) => want.id === id)) continue;
    const index = dashboard?.cards.findIndex((_, position) => homeCardId(position) === id) ?? -1;
    const card = index === -1 ? undefined : dashboard?.cards[index];
    findings.push(
      card && isRecentCard(card) && isRecord(item) && 'recent' in item
        ? `${file}: ${String(id)} lists the person's recent records, which only a person accepting the card proposed for Web UI's recently viewed card ${index + 1} writes, and no one has`
        : `${file}: ${JSON.stringify(id)} opens a list no dashboard card of the package shows`,
    );
  }
  return findings;
}

/**
 * What a list offers that Web UI's list, as the package writes it, does not: actions on its rows or
 * a selection, a record to create, or a search before it lists anything. The converter writes none
 * of them, so each asks the server for something the package does not.
 */
function offered(where: string, list: Record<string, unknown>, source: string): string[] {
  const findings: string[] = [];
  for (const [key, what] of [
    ['rowActions', 'actions on its rows'],
    ['bulkActions', 'actions on a selection'],
  ] as const)
    if (Array.isArray(list[key]) && list[key].length > 0)
      findings.push(
        `${where}: it offers ${what}, ${JSON.stringify(list[key])}, which ${source} does not`,
      );
  if ('create' in list)
    findings.push(`${where}: it offers to create a record, which ${source} does not`);
  if ('search' in list)
    findings.push(
      `${where}: it waits for a search before it lists anything, where ${source} does not`,
    );
  return findings;
}

/** What a card of the home shows, in words. */
function describeCard(item: Record<string, unknown>): string {
  if ('tasks' in item) return "the person's tasks";
  if ('recent' in item) return "the person's recent records";
  if ('queue' in item) return `a link to ${JSON.stringify(item['queue'])}`;
  return 'nothing a dashboard card shows';
}

/**
 * A menu's entries against those the package's left menu gives: each there once, opening the same
 * queue, and none besides.
 */
function opened(
  file: string,
  content: unknown,
  key: 'cards' | 'entries',
  expected: readonly { id: string; queue: string; source: string }[],
  none: string,
): string[] {
  const findings: string[] = [];
  const written = isRecord(content) && Array.isArray(content[key]) ? content[key] : [];
  for (const want of expected) {
    const matches = written.filter((item) => isRecord(item) && item['id'] === want.id);
    if (matches.length === 0) {
      findings.push(
        `${file}: ${want.id} is missing, though ${want.source} opens queues/${want.queue}.json`,
      );
      continue;
    }
    if (matches.length > 1)
      findings.push(`${file}: ${want.id} is there ${matches.length} times, not once`);
    const [item] = matches as Record<string, unknown>[];
    // Web UI's dashboard shows a list, never a figure: a KPI asks a page provider for a count
    // nothing in the package asks for.
    if ('kpi' in item)
      findings.push(`${file}: ${want.id} asks for a KPI, which ${want.source} does not show`);
    if (item['queue'] !== want.queue)
      findings.push(
        `${file}: ${want.id} opens ${JSON.stringify(item['queue'] ?? item['page'] ?? null)}, where ${want.source} opens queues/${want.queue}.json`,
      );
  }
  for (const item of written) {
    const id = isRecord(item) ? item['id'] : undefined;
    if (!expected.some((want) => want.id === id))
      findings.push(`${file}: ${JSON.stringify(id)} opens a list ${none}`);
  }
  return findings;
}
