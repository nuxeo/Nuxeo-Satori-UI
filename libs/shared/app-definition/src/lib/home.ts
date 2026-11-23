/**
 * The validators of an app's home, `home.json`, and its menu, `navigation.json`
 * (docs/business-apps/app-definition-v2.md, sections 9 and 10).
 *
 * A home is a list of cards, each shown or hidden by a rule: a KPI counts a page provider's
 * results, or the documents in one of its aggregates' buckets; a link opens a queue. A home per
 * group is cards whose rule is `app.rules.inGroup`. The menu is a list of entries, each opening a
 * queue or a page.
 *
 * No record is open on either, so a rule there is given literals, and a page provider's
 * parameters are literals, as a queue's are.
 */
import {
  createChecker,
  ICON,
  ID,
  isLiteral,
  join,
  NAME,
  unreadable,
  type Checker,
  type Finding,
} from './checker';
import { isRecord, PACKAGED_REGISTRIES, type Registries } from './registries';

const HOME_KEYS = ['$schema', 'version', 'label', 'labelKey', 'cards'];
const CARD_KEYS = ['id', 'label', 'labelKey', 'kpi', 'queue', 'visibleWhen'];
const KPI_KEYS = ['pageProvider', 'parameters', 'aggregate', 'bucket'];
const NAVIGATION_KEYS = ['$schema', 'version', 'entries'];
const ENTRY_KEYS = ['id', 'label', 'labelKey', 'icon', 'order', 'queue', 'page', 'visibleWhen'];

/** The keys each part of `home.json` may hold, which its JSON Schema must list too. */
export const HOME_V2_KEYS = { home: HOME_KEYS, card: CARD_KEYS, kpi: KPI_KEYS } as const;
/** The keys each part of `navigation.json` may hold, which its JSON Schema must list too. */
export const NAVIGATION_V2_KEYS = { navigation: NAVIGATION_KEYS, entry: ENTRY_KEYS } as const;

/** The page every app has, which a menu entry opens as `"page": "home"`. */
export const HOME_PAGE = 'home';

export interface HomeOptions {
  readonly registries?: Registries;
  /**
   * The ids of the package's queues, from the names of its `queues/<id>.json` files. Given, a
   * card or an entry naming another queue is an `unknown` finding; left out, as when the app reads
   * the file on its own, queues are not checked.
   */
  readonly queues?: ReadonlySet<string>;
}

export function validateHome(content: unknown, options: HomeOptions = {}): Finding[] {
  const stop = unreadable(content, 'a home file');
  if (stop) return stop;
  const home = content as Record<string, unknown>;
  const c = createChecker(options.registries ?? PACKAGED_REGISTRIES, { record: false });
  c.unknownKeys(home, HOME_KEYS, '');
  c.schemaKey(home);
  c.label(home, '');
  const cards = home['cards'];
  if (!Array.isArray(cards) || cards.length === 0) {
    c.add('cards', 'structure', 'needs a list of cards');
    return c.findings;
  }
  cards.forEach((item, index) => card(c, item, join('cards', index), options.queues));
  return c.findings;
}

export function validateNavigation(content: unknown, options: HomeOptions = {}): Finding[] {
  const stop = unreadable(content, 'a navigation file');
  if (stop) return stop;
  const navigation = content as Record<string, unknown>;
  const c = createChecker(options.registries ?? PACKAGED_REGISTRIES, { record: false });
  c.unknownKeys(navigation, NAVIGATION_KEYS, '');
  c.schemaKey(navigation);
  const entries = navigation['entries'];
  if (!Array.isArray(entries) || entries.length === 0) {
    c.add('entries', 'structure', 'needs a list of entries');
    return c.findings;
  }
  entries.forEach((item, index) => entry(c, item, join('entries', index), options.queues));
  return c.findings;
}

function card(
  c: Checker,
  item: unknown,
  path: string,
  queues: ReadonlySet<string> | undefined,
): void {
  if (!isRecord(item)) {
    c.add(path, 'structure', 'a card is an object');
    return;
  }
  c.unknownKeys(item, CARD_KEYS, path);
  c.claim(item['id'], join(path, 'id'));
  const hasKpi = 'kpi' in item;
  const hasQueue = 'queue' in item;
  if (!hasKpi && !hasQueue) c.add(path, 'structure', 'a card has a "kpi", a "queue", or both');
  // A link to a queue may show the queue's own name; a figure needs one of its own.
  if (hasKpi) {
    c.named(item, path);
    kpi(c, item['kpi'], join(path, 'kpi'));
  } else c.label(item, path);
  if (hasQueue) queue(c, item['queue'], join(path, 'queue'), queues);
  if ('visibleWhen' in item) c.rule(item['visibleWhen'], join(path, 'visibleWhen'));
}

/** What a KPI counts: a page provider's results, or the documents in one aggregate's bucket. */
function kpi(c: Checker, item: unknown, path: string): void {
  if (!isRecord(item)) {
    c.add(
      path,
      'structure',
      'a KPI is { "pageProvider", "parameters", "aggregate", "bucket" }, a page provider at least',
    );
    return;
  }
  c.unknownKeys(item, KPI_KEYS, path);
  if (typeof item['pageProvider'] !== 'string' || !NAME.test(item['pageProvider']))
    c.add(
      join(path, 'pageProvider'),
      'structure',
      'needs the name of a page provider defined on the server',
    );
  if ('parameters' in item) {
    const parameters = item['parameters'];
    if (!Array.isArray(parameters))
      c.add(join(path, 'parameters'), 'structure', 'parameters must be a list');
    else
      parameters.forEach((parameter, index) => {
        if (!isLiteral(parameter))
          c.add(
            join(join(path, 'parameters'), index),
            'structure',
            'no record is open on the home, so a page provider parameter is a literal',
          );
      });
  }
  if (
    'aggregate' in item &&
    (typeof item['aggregate'] !== 'string' || !NAME.test(item['aggregate']))
  )
    c.add(
      join(path, 'aggregate'),
      'structure',
      `needs the name of one of the page provider's aggregates`,
    );
  if ('bucket' in item) {
    if (typeof item['bucket'] !== 'string' || item['bucket'] === '')
      c.add(
        join(path, 'bucket'),
        'structure',
        `a bucket is the key of one of the aggregate's buckets`,
      );
    else if (!('aggregate' in item))
      c.add(join(path, 'bucket'), 'structure', 'a bucket is counted in an aggregate: name it too');
  }
}

function entry(
  c: Checker,
  item: unknown,
  path: string,
  queues: ReadonlySet<string> | undefined,
): void {
  if (!isRecord(item)) {
    c.add(path, 'structure', 'an entry is an object');
    return;
  }
  c.unknownKeys(item, ENTRY_KEYS, path);
  c.claim(item['id'], join(path, 'id'));
  const hasQueue = 'queue' in item;
  const hasPage = 'page' in item;
  if (hasQueue === hasPage)
    c.add(path, 'structure', 'an entry opens a "queue" or a "page": one of the two');
  if (hasQueue) {
    c.label(item, path);
    queue(c, item['queue'], join(path, 'queue'), queues);
  } else c.named(item, path);
  if (hasPage) page(c, item['page'], join(path, 'page'));
  if ('icon' in item && (typeof item['icon'] !== 'string' || !ICON.test(item['icon'])))
    c.add(
      join(path, 'icon'),
      'structure',
      'icon is the name of a Material Symbols icon, such as "inbox"',
    );
  if ('order' in item && !Number.isInteger(item['order']))
    c.add(join(path, 'order'), 'structure', 'order is a whole number');
  if ('visibleWhen' in item) c.rule(item['visibleWhen'], join(path, 'visibleWhen'));
}

/** A queue of the package, by its id: the name of its file in `queues/`. */
function queue(
  c: Checker,
  item: unknown,
  path: string,
  queues: ReadonlySet<string> | undefined,
): void {
  if (typeof item !== 'string' || !ID.test(item)) {
    c.add(path, 'structure', `names a queue by its id, its file's name in queues/`);
    return;
  }
  if (queues && !queues.has(item))
    c.add(path, 'unknown', `the queue "${item}" is not in the package: no queues/${item}.json`);
}

/** The app's home, or one of the platform's pages, by the ID of its menu entry. */
function page(c: Checker, item: unknown, path: string): void {
  if (typeof item !== 'string' || item === '') {
    c.add(path, 'structure', `a page is "${HOME_PAGE}" or the ID of a page's menu entry`);
    return;
  }
  if (item !== HOME_PAGE && !c.registries.pages.has(item))
    c.add(path, 'unknown', `the page "${item}" is not registered`);
}
