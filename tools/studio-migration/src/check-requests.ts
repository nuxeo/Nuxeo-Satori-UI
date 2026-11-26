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
import { homeCards, menuEntries } from './convert-home';
import { openingSort, queueOwners } from './convert-lists';
import { actionOwners } from './convert-slots';
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

  // The home and the menu open the same lists as Web UI's dashboard and left menu, and no other.
  findings.push(
    ...opened(
      'home.json',
      app['home.json'],
      'cards',
      homeCards(inventory).map((card) => ({
        id: card.id,
        queue: card.queue,
        source: `Web UI's dashboard card ${card.index + 1}`,
      })),
      'no dashboard card of the package shows',
    ),
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
 * A home's cards or a menu's entries against those the package's dashboard or left menu gives:
 * each there once, opening the same queue, and none besides.
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
