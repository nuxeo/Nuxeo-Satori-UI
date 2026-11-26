import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readContentModel, type ContentModel } from './content-model';
import {
  listedColumnFindings,
  listedType,
  nxqlProblems,
  type ListingProvider,
} from './page-providers';

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
      'none, for a pattern over a type, FROM it, which lists its subtypes too',
      'SELECT * FROM Contract WHERE contract:status = ?',
      true,
      null,
    ],
    [
      'none, with a facet asked for, which brings schemas of its own',
      "ecm:primaryType = 'A' AND ecm:mixinType = 'Reviewable'",
      false,
      null,
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

describe("nxqlProblems: what in a page provider's NXQL Nuxeo refuses, as far as a pattern check tells", () => {
  it("finds the moves kit's BETWEEN NOW(...), which the server answered 400", () => {
    const where =
      "ecm:primaryType = 'Move' AND move:loadDate BETWEEN NOW('-P1D') AND NOW('P7D') AND ecm:isTrashed = 0";
    expect(nxqlProblems(where, { pattern: false })).toEqual([
      expect.stringContaining('BETWEEN takes a literal on each side of its AND'),
    ]);
    // The condition is shown, as far as it goes.
    expect(nxqlProblems(`SELECT * FROM Document WHERE ${where}`, { pattern: true })[0]).toContain(
      `"BETWEEN NOW('-P1D') AND NOW('P7D')" does not`,
    );
    expect(nxqlProblems('(x:a BETWEEN NOW() AND 3) OR x:b = 1', { pattern: false })[0]).toContain(
      '"BETWEEN NOW() AND 3" does not',
    );
  });

  const refused: [string, string, boolean, string][] = [
    ['a property as a bound', 'x:a BETWEEN x:b AND 3', false, 'BETWEEN takes a literal'],
    ['a bound missing', "x:a BETWEEN 'a'", false, 'BETWEEN takes a literal'],
    ['an unclosed string', "dc:title = 'open", false, 'a string is not closed'],
    ['an unclosed parenthesis', '(dc:title = 1 AND (x:y = 2)', false, 'a "(" is not closed'],
    ['a parenthesis that closes nothing', 'dc:title = 1)', false, 'a ")" closes nothing'],
    ['==', 'dc:title == 1', false, '"==" is not NXQL'],
    ['&&', 'x:a = 1 && x:b = 2', false, '"&&" is not NXQL'],
    ['||', 'x:a = 1 || x:b = 2', false, '"||" is not NXQL'],
    ['a second statement', 'x:a = 1; x:b = 2', false, '";" is not NXQL'],
    ['a NOT written !', '! x:a = 1', false, '"!" is not NXQL'],
    ['a pattern that is not a query', "ecm:primaryType = 'A'", true, 'a pattern is a whole query'],
  ];
  it.each(refused)('finds %s', (_, nxql, pattern, problem) => {
    expect(nxqlProblems(nxql, { pattern }).join('\n')).toContain(problem);
  });

  const passed: [string, string, boolean][] = [
    ['literal bounds', "dc:created BETWEEN DATE '2020-01-01' AND DATE '2021-01-01'", false],
    [
      'numbers and timestamps',
      "x:n BETWEEN -1 AND 2.5 AND x:t NOT BETWEEN TIMESTAMP '2020-01-01 00:00:00' AND ?",
      false,
    ],
    ['parameters', 'x:n BETWEEN ? AND :upper', false],
    [
      'typed parameters, given their values before the query is read',
      'x:d BETWEEN DATE ? AND DATE ? AND x:t BETWEEN TIMESTAMP :from AND TIMESTAMP :to',
      false,
    ],
    ['floats in every form', 'x:n BETWEEN .5 AND 2. AND x:m BETWEEN 1.5e3 AND -2E-1', false],
    ['NOW() compared', "move:loadDate >= NOW('-P1D') AND move:loadDate <= NOW('P7D')", false],
    [
      'every operator',
      "a:b <> 'x' AND a:c != 1 AND a:d <= 2 AND a:e >= 3 AND a:f < 4 AND a:g > 5 AND a:h LIKE 'x%' AND a:i ILIKE 'y' AND a:j IS NOT NULL AND a:k IN ('A', 'B') AND a:l STARTSWITH '/x'",
      false,
    ],
    [
      'quotes, escapes and symbols inside strings',
      "dc:title = 'it\\'s == && || ; ! (' AND dc:description = \"a ) b\"",
      false,
    ],
    [
      'a list property and a path',
      "dc:subjects/* = 'x' AND files:files/*1/file/name LIKE '%.pdf'",
      false,
    ],
    ['a whole query', "SELECT * FROM Document WHERE ecm:primaryType = 'A' ORDER BY dc:title", true],
  ];
  it.each(passed)('passes %s', (_, nxql, pattern) => {
    expect(nxqlProblems(nxql, { pattern })).toEqual([]);
  });

  it("passes every kit's own page providers, as their components hold them", () => {
    const decoded = (text: string): string =>
      text
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
    let read = 0;
    for (const kit of readdirSync(KITS)) {
      const components = join(KITS, kit, 'bundle', 'OSGI-INF');
      if (!existsSync(components)) continue;
      for (const file of readdirSync(components).filter((name) => name.endsWith('.xml'))) {
        const xml = readFileSync(join(components, file), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
        for (const [, element, text] of xml.matchAll(
          /<(pattern|fixedPart)[^>]*>([\s\S]*?)<\/\1>/g,
        )) {
          read++;
          expect(
            nxqlProblems(decoded(text), { pattern: element === 'pattern' }),
            `${kit}/${file}`,
          ).toEqual([]);
        }
      }
    }
    // Every kit's page providers were read: 21 when this was written.
    expect(read).toBeGreaterThanOrEqual(21);
  });
});
