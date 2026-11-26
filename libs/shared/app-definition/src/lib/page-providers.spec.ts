import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readContentModel, type ContentModel } from './content-model';
import { listedColumnFindings, listedType, type ListingProvider } from './page-providers';

const KITS = join(import.meta.dirname, '..', '..', '..', '..', '..', 'business-apps', 'packages');
const read = (...path: string[]): unknown => JSON.parse(readFileSync(join(KITS, ...path), 'utf8'));
const CONFIG = ['bundle', 'agentic-ui-config'];

function modelOf(kit: string): ContentModel {
  const reading = readContentModel(read(kit, 'content-model.json'));
  if (!reading.model) throw new Error(`${kit}: ${reading.problems.join('; ')}`);
  return reading.model;
}

describe('listedType: the one type a page provider lists, from its NXQL', () => {
  const cases: [string, string, boolean, string | null][] = [
    [
      'a fixed part that names it first, as app-model writes one',
      "ecm:primaryType = 'DamageClaim' AND (dmg:state IN ('Filed', 'In review')) AND ecm:isVersion = 0",
      false,
      'DamageClaim',
    ],
    [
      'a pattern, after its WHERE',
      "SELECT * FROM Document WHERE ecm:primaryType = 'MoveItem' AND (moveitem:move = ?) ORDER BY dc:title",
      true,
      'MoveItem',
    ],
    ['in double quotes', 'ecm:primaryType = "Contract" AND x:y = 1', false, 'Contract'],
    [
      'a pattern over a type, FROM it',
      'SELECT * FROM Contract WHERE contract:status = ?',
      true,
      'Contract',
    ],
    [
      'none, when an OR at the top lets others in',
      "ecm:primaryType = 'A' OR dc:title = 'x'",
      false,
      null,
    ],
    ['none, between two types', "(ecm:primaryType = 'A' OR ecm:primaryType = 'B')", false, null],
    ['none, under a NOT', "NOT ecm:primaryType = 'A' AND x:y = 1", false, null],
    ['none, for any other operator', "ecm:primaryType <> 'A'", false, null],
    ['none, for a list', "ecm:primaryType IN ('A')", false, null],
    ['none, inside a string', "dc:title = 'ecm:primaryType = ''A'''", false, null],
    ['none, for two', "ecm:primaryType = 'A' AND ecm:primaryType = 'B'", false, null],
    [
      'none, for a pattern over every document',
      'SELECT * FROM Document WHERE dc:title = ?',
      true,
      null,
    ],
  ];
  it.each(cases)('%s', (_, nxql, pattern, expected) => {
    expect(listedType(nxql, { pattern })).toBe(expected);
  });
});

describe("listedColumnFindings: a list's columns and sorts, held to the type its page provider lists", () => {
  const model = modelOf('moves-demo');
  const providers = new Map<string, ListingProvider>([
    ['moves_open_claims', { listed: 'DamageClaim', component: 'OSGI-INF/moves-demo-model.xml' }],
    ['moves_move_items', { listed: 'MoveItem', component: 'OSGI-INF/moves-demo-model.xml' }],
    ['moves_move_claims', { listed: 'DamageClaim', component: 'OSGI-INF/moves-demo-model.xml' }],
    ['moves_somewhere', { listed: null, component: 'OSGI-INF/moves-demo-model.xml' }],
  ]);
  const queue = read('moves-demo', ...CONFIG, 'queues', 'open-claims.json') as Record<
    string,
    unknown
  >;
  const move = read('moves-demo', ...CONFIG, 'layouts', 'Move', 'view.layout.json') as Record<
    string,
    unknown
  >;
  const misspelt = (value: unknown, from: string, to: string): unknown =>
    JSON.parse(JSON.stringify(value).split(`"${from}"`).join(`"${to}"`));

  it("passes the moves kit's own queue and record page", () => {
    expect(listedColumnFindings('queues/open-claims.json', queue, providers, model)).toEqual([]);
    expect(listedColumnFindings('layouts/Move/view.layout.json', move, providers, model)).toEqual(
      [],
    );
  });

  it("finds the log's first misspelling: dmg:adjustor in a queue's columns", () => {
    expect(
      listedColumnFindings(
        'queues/open-claims.json',
        misspelt(queue, 'dmg:adjuster', 'dmg:adjustor'),
        providers,
        model,
      ),
    ).toEqual([
      {
        path: 'columns[6].field',
        kind: 'unknown',
        message:
          '"dmg:adjustor" is not a property of the type "DamageClaim", which the page provider "moves_open_claims" (OSGI-INF/moves-demo-model.xml) lists, or of its facets',
      },
    ]);
  });

  it("finds the log's second: moveitem:rooms in a related list's columns", () => {
    expect(
      listedColumnFindings(
        'layouts/Move/view.layout.json',
        misspelt(move, 'moveitem:room', 'moveitem:rooms'),
        providers,
        model,
      ),
    ).toEqual([
      expect.objectContaining({
        path: 'cards[4].related.columns[2]',
        kind: 'unknown',
        message: expect.stringContaining(
          '"moveitem:rooms" is not a property of the type "MoveItem", which the page provider "moves_move_items"',
        ),
      }),
    ]);
  });

  it('finds a sort on a property the listed records do not have', () => {
    expect(
      listedColumnFindings(
        'queues/open-claims.json',
        { ...queue, sort: [{ field: 'dmg:filedAt', order: 'asc' }] },
        providers,
        model,
      ),
    ).toEqual([expect.objectContaining({ path: 'sort[0].field', kind: 'unknown' })]);
  });

  it('finds a widget that does not show its column, as a layout field is held', () => {
    const columns = [{ field: 'dmg:state', widget: 'currency' }];
    expect(
      listedColumnFindings('queues/open-claims.json', { ...queue, columns }, providers, model),
    ).toEqual([
      {
        path: 'columns[0].widget',
        kind: 'parameter',
        message: expect.stringContaining(
          'the widget "currency" does not show "dmg:state", a string property of the type "DamageClaim"',
        ),
      },
    ]);
  });

  it("holds nothing to a page provider the package does not define, or whose type it cannot tell, or the server's own properties", () => {
    const wrong = misspelt(queue, 'dmg:adjuster', 'dmg:adjustor') as Record<string, unknown>;
    expect(
      listedColumnFindings(
        'queues/open-claims.json',
        { ...wrong, pageProvider: 'default_search' },
        providers,
        model,
      ),
    ).toEqual([]);
    expect(
      listedColumnFindings(
        'queues/open-claims.json',
        { ...wrong, pageProvider: 'moves_somewhere' },
        providers,
        model,
      ),
    ).toEqual([]);
    expect(
      listedColumnFindings(
        'queues/open-claims.json',
        { ...queue, columns: ['ecm:uuid', { field: 'ecm:currentLifeCycleState' }] },
        providers,
        model,
      ),
    ).toEqual([]);
  });

  it('reads the cards of each tab too', () => {
    const tabbed = {
      version: 2,
      tabs: [
        {
          id: 'main',
          labelKey: 'x',
          cards: (misspelt(move, 'moveitem:room', 'moveitem:rooms') as { cards: unknown[] }).cards,
        },
      ],
    };
    expect(
      listedColumnFindings('layouts/Move/view.layout.json', tabbed, providers, model).map(
        (finding) => finding.path,
      ),
    ).toEqual(['tabs[0].cards[4].related.columns[2]']);
  });
});
