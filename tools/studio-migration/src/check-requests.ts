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
 * - **nothing is asked that Web UI does not ask:** every queue and action comes from the package.
 *
 * Recording the requests both apps send, and comparing the result counts once search has caught up
 * with recent writes, needs the migration server: that half has not run, and the check says so.
 */
import { isRecord } from '@agentic-ui/shared/app-definition';
import {
  actionIdOf,
  appIdOf,
  homeQueueId,
  placed,
  queuePageSize,
  queuePath,
  searchQueueId,
} from './app-files';
import { sameJson } from './app-walk';
import { slotEntry } from './catalogue';
import { cardParameters, isListCard, openingSort } from './convert-lists';
import { buttonAction } from './convert-slots';
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
  ): void => {
    expectedQueues.add(path);
    const queue = app[path];
    if (!isRecord(queue)) return;
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

  for (const search of inventory.searches) {
    if (search.part !== 'results' || search.provider === null) continue;
    // Web UI's form sends a predicate's parameter only once someone fills it in.
    list(queuePath(searchQueueId(search)), search.provider, [], openingSort(search), null);
  }
  inventory.dashboard?.cards.forEach((card, index) => {
    if (!isListCard(card) || card.provider === null) return;
    const parameters = cardParameters(card);
    if ('problem' in parameters) return;
    // Web UI's data table asks a card's provider for its own page size, which a queue keeps when
    // it is one a queue takes.
    list(
      queuePath(homeQueueId(card, index)),
      card.provider,
      parameters.parameters,
      [],
      queuePageSize(card),
    );
  });
  for (const path of Object.keys(app))
    if (path.startsWith('queues/') && !expectedQueues.has(path))
      findings.push(`${path}: it asks for a list that no screen or card of the package asks for`);

  const actions = app['actions.json'];
  const written = isRecord(actions) && Array.isArray(actions['actions']) ? actions['actions'] : [];
  const appId = appIdOf(pkg);
  const expectedActions = new Set<string>();
  for (const { contribution, index } of placed(inventory.slotContributions)) {
    const slot = slotEntry(catalogue, contribution.slot)?.slot;
    if (slot !== 'toolbar' && slot !== 'bulk-actions') continue;
    const button = buttonAction(contribution);
    if ('problem' in button) continue;
    const id = actionIdOf(appId, contribution.name, index);
    expectedActions.add(id);
    const action = written.find((candidate) => isRecord(candidate) && candidate['id'] === id);
    if (!isRecord(action)) {
      if (entries.get(`slot-contribution:${contribution.path}#${index}`)?.outcome === 'converted')
        findings.push(
          `actions.json: ${id} is missing, though the report says "${contribution.name}" became it`,
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
