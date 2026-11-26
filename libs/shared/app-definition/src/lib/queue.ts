/**
 * The validator of a queue, `queues/<id>.json` (docs/business-apps/app-definition-v2.md, section
 * 4): a page provider with columns, facets, sorts, row and bulk actions, and a rule for who sees it.
 *
 * Its page provider, parameters, columns, sort, page size and row actions are a related-records
 * list's (layout-v2.md, section 7), except that a queue has no open record to take a parameter
 * from. Its row and bulk actions may be the package's own: the caller registers those from
 * `actions.json` (see `withPackageActions`).
 */
import { createChecker, join, NAME, unreadable, type Checker, type Finding } from './checker';
import { isRecord, PACKAGED_REGISTRIES, type Registries } from './registries';

const QUEUE_KEYS = [
  '$schema',
  'version',
  'label',
  'labelKey',
  'pageProvider',
  'parameters',
  'columns',
  'sort',
  'pageSize',
  'facets',
  'rowActions',
  'bulkActions',
  'visibleWhen',
];
const FACET_KEYS = ['aggregate', 'label', 'labelKey', 'widget'];

/**
 * The widgets a facet's buckets may be shown through (app-definition-v2.md, section 4): a
 * `document-link`, for an aggregate on a reference, whose buckets are records' ids, shown by their
 * records' titles. Without one, a bucket shows its key as the server returns it.
 */
export const FACET_WIDGETS: readonly string[] = ['document-link'];

/** The keys each part of a queue may hold, which its JSON Schema must list too. */
export const QUEUE_V2_KEYS = { queue: QUEUE_KEYS, facet: FACET_KEYS } as const;

export function validateQueue(
  content: unknown,
  options: { readonly registries?: Registries } = {},
): Finding[] {
  const stop = unreadable(content, 'a queue file');
  if (stop) return stop;
  const queue = content as Record<string, unknown>;
  const c = createChecker(options.registries ?? PACKAGED_REGISTRIES);
  c.unknownKeys(queue, QUEUE_KEYS, '');
  c.schemaKey(queue);
  c.named(queue, '');
  c.list(queue, '', { openRecord: false });
  if ('facets' in queue) facets(c, queue['facets']);
  if ('bulkActions' in queue)
    c.actions(queue['bulkActions'], 'bulkActions', c.registries.bulkActions, 'bulk action');
  if ('visibleWhen' in queue) c.rule(queue['visibleWhen'], 'visibleWhen');
  return c.findings;
}

/** Filters from the page provider's aggregates, each named as the server defines it. */
function facets(c: Checker, value: unknown): void {
  if (!Array.isArray(value)) {
    c.add('facets', 'structure', 'facets must be a list');
    return;
  }
  value.forEach((facet, index) => {
    const at = join('facets', index);
    if (!isRecord(facet)) {
      c.add(at, 'structure', 'a facet is { "aggregate": <name>, "label" or "labelKey" }');
      return;
    }
    c.unknownKeys(facet, FACET_KEYS, at);
    c.label(facet, at);
    if ('widget' in facet) {
      const widget = facet['widget'];
      if (typeof widget !== 'string')
        c.add(join(at, 'widget'), 'structure', 'a widget is named by its ID');
      else if (!Object.hasOwn(c.registries.widgets, widget))
        c.add(join(at, 'widget'), 'unknown', `the widget "${widget}" is not registered`);
      else if (!FACET_WIDGETS.includes(widget))
        c.add(
          join(at, 'widget'),
          'parameter',
          `a facet shows its buckets as the server returns them, or through ${FACET_WIDGETS.map((each) => `"${each}"`).join(' or ')}, not "${widget}"`,
        );
    }
    if (typeof facet['aggregate'] !== 'string' || !NAME.test(facet['aggregate']))
      c.add(
        join(at, 'aggregate'),
        'structure',
        `needs the name of one of the page provider's aggregates`,
      );
  });
}
