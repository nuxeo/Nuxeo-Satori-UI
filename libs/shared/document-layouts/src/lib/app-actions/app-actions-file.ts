/**
 * An app's `actions.json`, read as the app reads it (docs/business-apps/app-definition-v2.md,
 * sections 5 and 12): the buttons that run an operation on one record, on the record page's toolbar
 * and on a queue's rows.
 *
 * Tolerant, as a queue is when it loads: a `structure` finding of the file's own refuses it whole;
 * one in an action, or an `unknown` or a `parameter` finding, leaves that action out, and the
 * console says why. So does a rule this build cannot answer, in `visibleWhen` or `enabledWhen`: the
 * registry would pass it. A lifecycle button, an action with `transition`, is left out too, saying
 * so: this build runs operations, and the platform's own lifecycle button offers transitions.
 *
 * The operation is not held to an allow-list here. The browser does not know the server's, and
 * trusting it would be no control: the app registry serves the file with only the actions the
 * server's allow-list lets run, and `AgenticUi.RunAction` checks it again before anything runs.
 */
import {
  PACKAGED_REGISTRIES,
  validateActions,
  withRegistered,
  type Finding,
} from '@agentic-ui/shared/app-definition';
import type { ExtensionRule } from '@nuxeo/satori-platform/extensions';

import { describe, refusedRule } from '../record-page/record-layout';

/**
 * Where an operation's button shows: the record page's toolbar, a queue's row menu, or a card of
 * the record page that names it, as a holds card names the actions that place and release a hold.
 */
export type AppActionPlacement = 'record' | 'row' | 'card';

/** A confirmation, or a success message: a literal, which wins, or a key to look one up by. */
export interface AppActionMessage {
  readonly label: string | null;
  readonly labelKey: string | null;
}

/** One action that runs an operation, as `actions.json` writes it, once it has been read. */
export interface AppActionDefinition {
  readonly id: string;
  readonly label: string | null;
  readonly labelKey: string | null;
  readonly icon: string | null;
  readonly order: number | null;
  /** On one record: the record page's, a row's, a card's, or several. Never empty. */
  readonly placements: readonly AppActionPlacement[];
  readonly visibleWhen: ExtensionRule | null;
  readonly enabledWhen: ExtensionRule | null;
  readonly operation: string;
  /** The fields the person fills in before it runs, as written; `null` when it asks for nothing. */
  readonly form: readonly unknown[] | null;
  readonly confirm: AppActionMessage | null;
  readonly success: AppActionMessage | null;
  /** Whether the lists, and the record, are read again after it runs. True when left out. */
  readonly refresh: boolean;
}

/** What this build registers, by ID, that the file may name or may not take the id of. */
export interface AppActionsRegistered {
  readonly rules: readonly string[];
  readonly rowActions: readonly string[];
  readonly bulkActions: readonly string[];
  /** Every other slot's actions registered in code, the toolbar's among them. */
  readonly actions: readonly string[];
}

export type ReadAppActions =
  | { readonly actions: readonly AppActionDefinition[]; readonly problems: readonly string[] }
  | { readonly refused: readonly string[] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

const show = (finding: Finding): string => `${describe(finding)} [${finding.kind}]`;

/** The action a finding is in, `actions[2]`, or `null` for one about the file itself. */
const actionOf = (path: string): string | null => /^actions\[\d+\]/.exec(path)?.[0] ?? null;

function message(value: unknown): AppActionMessage | null {
  return isRecord(value)
    ? { label: text(value['label']), labelKey: text(value['labelKey']) }
    : null;
}

/** Every operation the file names: the browser holds none to an allow-list (see above). */
function operationsIn(content: unknown): ReadonlySet<string> {
  const actions = isRecord(content) ? content['actions'] : undefined;
  return new Set(
    (Array.isArray(actions) ? actions : []).flatMap((action) =>
      isRecord(action) && typeof action['operation'] === 'string' ? [action['operation']] : [],
    ),
  );
}

export function readAppActions(content: unknown, registered: AppActionsRegistered): ReadAppActions {
  const findings = validateActions(content, {
    registries: withRegistered(PACKAGED_REGISTRIES, registered),
    operations: operationsIn(content),
  });
  const ofTheFile = findings.filter(
    (finding) => finding.kind === 'structure' && actionOf(finding.path) === null,
  );
  if (ofTheFile.length > 0) return { refused: ofTheFile.map(show) };

  const problems: string[] = [];
  const leftOut = new Set<string>();
  for (const finding of findings) {
    const place = actionOf(finding.path);
    if (place) leftOut.add(place);
    // A finding outside an action, with no `structure` one, is a key of the file's own: ignored.
    problems.push(`${show(finding)}; ${place ? `${place} left out` : 'ignored'}`);
  }

  const known = new Set(registered.rules);
  const isRuleKnown = (id: string): boolean => known.has(id);
  const actions: AppActionDefinition[] = [];
  const list = (content as Record<string, unknown>)['actions'] as readonly unknown[];
  list.forEach((item, index) => {
    const place = `actions[${index}]`;
    if (leftOut.has(place) || !isRecord(item)) return;
    const id = item['id'] as string;
    if (!('operation' in item)) {
      problems.push(
        `${place} "${id}" is a lifecycle button, which this build does not run from actions.json: the platform's own offers the record's transitions; left out`,
      );
      return;
    }
    for (const key of ['visibleWhen', 'enabledWhen'] as const) {
      const refused = refusedRule(item[key], isRuleKnown);
      if (refused) {
        problems.push(`${place}.${key} ${refused}; ${place} left out`);
        leftOut.add(place);
      }
    }
    if (leftOut.has(place)) return;
    const on = Array.isArray(item['on']) ? item['on'] : ['record'];
    const placements = on.filter(
      (where): where is AppActionPlacement =>
        where === 'record' || where === 'row' || where === 'card',
    );
    if (placements.length === 0) {
      problems.push(
        `${place} "${id}" runs in bulk only, which this build does not run from actions.json; left out`,
      );
      return;
    }
    actions.push({
      id,
      label: text(item['label']),
      labelKey: text(item['labelKey']),
      icon: text(item['icon']),
      order: typeof item['order'] === 'number' ? item['order'] : null,
      placements,
      visibleWhen: (item['visibleWhen'] as ExtensionRule | undefined) ?? null,
      enabledWhen: (item['enabledWhen'] as ExtensionRule | undefined) ?? null,
      operation: item['operation'] as string,
      form: Array.isArray(item['form']) ? item['form'] : null,
      confirm: message(item['confirm']),
      success: message(item['success']),
      refresh: item['refresh'] !== false,
    });
  });
  return { actions, problems };
}
