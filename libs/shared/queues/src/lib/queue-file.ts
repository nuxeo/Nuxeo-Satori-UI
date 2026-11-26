/**
 * A queue, `queues/<id>.json`, read as the app reads it (docs/business-apps/app-definition-v2.md,
 * sections 4 and 12), and tolerant as a layout is when it loads (layout-v2.md, section 8):
 *
 * - a `structure` finding refuses the file, and no queue is drawn;
 * - an `unknown` or `parameter` finding leaves out the column, facet, row action or bulk action it
 *   is in, and the console says why. Elsewhere it is about a key of the queue's own, which is
 *   ignored;
 * - a column this build does not draw in a list is left out, as in a related-records card, and a
 *   queue with no column left is refused;
 * - an empty parameter refuses it too, as a related list is not asked with one: an empty value
 *   matches what its author did not mean, or nothing;
 * - a facet whose aggregate a request cannot filter on is left out: see `isAggregateParameter`;
 * - a search with a finding is left out, and the queue drawn without one, which asks its page
 *   provider with one parameter fewer than it takes, so the queue is refused instead;
 * - a rule this build cannot answer hides the queue from everyone. That is a finding in
 *   `visibleWhen`, a rule this build does not register, or one nested deeper than the rule
 *   registry answers. The registry would answer `true` for it, and show the queue to everyone.
 *
 * The app reads the file alone, without its package, so an action from the package's
 * `actions.json` is one this build does not register, and is left out: phase 2 runs them. The
 * pipeline checks the package's actions when it is built.
 *
 * Hiding a queue is not a security control. The page provider still returns only what the person
 * may read, and the address still answers.
 */
import {
  PACKAGED_REGISTRIES,
  validateQueue,
  withRegistered,
  type Finding,
} from '@agentic-ui/shared/app-definition';
import { readRecordList, type RecordListEntry } from '@agentic-ui/shared/document-layouts';
import { refusedRule } from '@agentic-ui/shared/home';
import type { ExtensionRule } from '@nuxeo/satori-platform/extensions';
import { isAggregateParameter } from '@nuxeo/satori-platform/nuxeo-client';

/** A filter from one of the page provider's aggregates. */
export interface QueueFacet {
  /** The aggregate's id, as the page provider defines it on the server. */
  readonly aggregate: string;
  readonly label: string | null;
  readonly labelKey: string | null;
  /**
   * `document-link` for an aggregate on a reference: each bucket, a record's id, shown by that
   * record's title (app-definition-v2.md, section 4). `null`, a bucket shows its key.
   */
  readonly widget: 'document-link' | null;
}

/**
 * A text field above a queue's list, whose text, trimmed, is the page provider's last parameter,
 * after the queue's own (app-definition-v2.md, section 4).
 */
export interface QueueSearch {
  readonly label: string | null;
  readonly labelKey: string | null;
  /** Whether a search that finds one record alone opens it, as a scanned barcode opens its item. */
  readonly openSingle: boolean;
}

export interface QueueFile {
  readonly label: string | null;
  readonly labelKey: string | null;
  /** The page provider, its columns, order, page size and row actions. */
  readonly list: RecordListEntry;
  /** The page provider's parameters, literals each written as it is sent. */
  readonly parameters: readonly string[];
  /** The queue's search, or `null` when it has none and its list is drawn at once. */
  readonly search: QueueSearch | null;
  readonly facets: readonly QueueFacet[];
  /** The bulk actions by id, as the file lists them, less those a finding leaves out. */
  readonly bulkActions: readonly string[];
  readonly visibleWhen: ExtensionRule | null;
  /** Whether the queue is hidden from everyone: its rule is one this build cannot answer. */
  readonly alwaysHidden: boolean;
}

/** What this build registers, by ID, that a queue may name. */
export interface QueueRegistered {
  /** The rule registry's rules. */
  readonly rules: readonly string[];
  /** The row actions slot's actions, a customer's own among them. */
  readonly rowActions: readonly string[];
  /** The bulk actions slot's actions, a customer's own among them. */
  readonly bulkActions: readonly string[];
}

/**
 * The queue, and what the console is to say about it: each part left out, and why, and each key
 * of the queue's own that is ignored. Or, when it is refused, what refuses it.
 */
export type ReadQueue =
  | { readonly queue: QueueFile; readonly problems: readonly string[] }
  | { readonly refused: readonly string[] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);

const describe = (finding: Finding): string =>
  `${finding.path || 'the file'}: ${finding.message} [${finding.kind}]`;

/** The part of the queue a finding is in, from its path: `columns[1]`, `facets[0]`; else `null`. */
function partOf(path: string): string | null {
  return /^(?:columns|rowActions|bulkActions|facets)\[\d+\]/.exec(path)?.[0] ?? null;
}

const inRule = (path: string): boolean => path === 'visibleWhen' || /^visibleWhen[.[]/.test(path);

/**
 * The queue in `content`, read with what this build registers: a customer's own rule or action,
 * registered in Layer 2 code, is known though the validator's packaged lists lack it, and a
 * platform rule this build was made without is not.
 */
export function readQueue(content: unknown, registered: QueueRegistered): ReadQueue {
  const findings = validateQueue(content, {
    registries: withRegistered(PACKAGED_REGISTRIES, {
      rules: registered.rules,
      rowActions: registered.rowActions,
      bulkActions: registered.bulkActions,
    }),
  });
  const structural = findings.filter((finding) => finding.kind === 'structure');
  if (structural.length > 0) return { refused: structural.map(describe) };
  // A search left out would ask the page provider with one parameter fewer than it takes.
  const inSearch = findings.filter(
    (finding) => finding.path === 'search' || finding.path.startsWith('search.'),
  );
  if (inSearch.length > 0) return { refused: inSearch.map(describe) };

  // With no `structure` finding the file has a queue's shape: an object with a page provider, a
  // list of columns, literal parameters, and well-formed facets, actions and rule where it has them.
  const file = content as Record<string, unknown>;
  const problems: string[] = [];
  const leftOut = new Set<string>();
  let alwaysHidden = false;
  for (const finding of findings) {
    if (inRule(finding.path)) {
      alwaysHidden = true;
      problems.push(`${describe(finding)}; the queue is hidden`);
      continue;
    }
    const part = partOf(finding.path);
    if (part !== null) leftOut.add(part);
    problems.push(`${describe(finding)}; ${part === null ? 'ignored' : `${part} left out`}`);
  }

  const rules = new Set(registered.rules);
  const isRuleKnown = (id: string): boolean => rules.has(id);
  const list = readRecordList(file, '', 'the queue', { leftOut, isRuleKnown, problems });
  if (list === null) return { refused: problems };
  const empty = list.parameters.findIndex((parameter) => parameter === '');
  if (empty >= 0) {
    return {
      refused: [
        `parameters[${empty}] is empty: a page provider asked with an empty parameter matches what its author did not mean, or nothing`,
      ],
    };
  }

  const refused = alwaysHidden ? null : refusedRule(file['visibleWhen'], isRuleKnown);
  if (refused) {
    alwaysHidden = true;
    problems.push(`visibleWhen ${refused}; the queue is hidden`);
  }

  const facets: QueueFacet[] = [];
  const shown = new Set<string>();
  ((file['facets'] as unknown[] | undefined) ?? []).forEach((facet, index) => {
    const place = `facets[${index}]`;
    if (leftOut.has(place) || !isRecord(facet)) return;
    const aggregate = facet['aggregate'] as string;
    if (!isAggregateParameter(aggregate)) {
      problems.push(
        `${place}: the aggregate "${aggregate}" cannot be sent back as a filter: a name of letters, digits and _, and none the search reads for itself; ${place} left out`,
      );
      return;
    }
    if (shown.has(aggregate)) {
      problems.push(`${place} filters on "${aggregate}" again; ${place} left out`);
      return;
    }
    shown.add(aggregate);
    facets.push({
      aggregate,
      label: text(facet['label']),
      labelKey: text(facet['labelKey']),
      widget: facet['widget'] === 'document-link' ? 'document-link' : null,
    });
  });

  const searchEntry = isRecord(file['search']) ? file['search'] : null;
  const search: QueueSearch | null =
    searchEntry === null
      ? null
      : {
          label: text(searchEntry['label']),
          labelKey: text(searchEntry['labelKey']),
          openSingle: searchEntry['open'] === 'single',
        };

  const bulkActions = ((file['bulkActions'] as unknown[] | undefined) ?? []).filter(
    (id, index): id is string => typeof id === 'string' && !leftOut.has(`bulkActions[${index}]`),
  );

  return {
    queue: {
      label: text(file['label']),
      labelKey: text(file['labelKey']),
      list,
      parameters: list.parameters.map((parameter) => String(parameter)),
      search,
      facets,
      bulkActions,
      visibleWhen: (file['visibleWhen'] as ExtensionRule | undefined) ?? null,
      alwaysHidden,
    },
    problems,
  };
}
