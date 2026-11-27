import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readContentModel, type ContentModel } from './content-model';
import {
  listedColumnFindings,
  listedType,
  nxqlNameProblems,
  nxqlProblems,
  parameterFindings,
  positionalParameters,
  propertyNameProblem,
  type ListingProvider,
} from './page-providers';

const KITS = join(import.meta.dirname, '..', '..', '..', '..', '..', 'business-apps', 'packages');
const read = (...path: string[]): unknown => JSON.parse(readFileSync(join(KITS, ...path), 'utf8'));
const CONFIG = ['bundle', 'agentic-ui-config'];

/** XML with each comment taken out whole, one after the other, as a reader skips them. */
function withoutComments(xml: string): string {
  let out = '';
  let at = 0;
  for (;;) {
    const start = xml.indexOf('<!--', at);
    if (start === -1) return out + xml.slice(at);
    out += xml.slice(at, start);
    const end = xml.indexOf('-->', start + 4);
    if (end === -1) return out;
    at = end + 3;
  }
}

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
        const xml = withoutComments(readFileSync(join(components, file), 'utf8'));
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

describe("nxqlNameProblems: what a page provider's NXQL names, held to the content model", () => {
  const model = modelOf('vehicle-titles-demo');
  const missing = (where: string) =>
    nxqlNameProblems(
      `SELECT * FROM Document WHERE ecm:primaryType = 'VehicleDeal' AND (${where}) AND ecm:isVersion = 0`,
      { pattern: true },
      model,
    );

  it("finds the vehicle kit's log's two: a checklist's subfield and a title's date, misspelt", () => {
    expect(missing("vdeal:status = 'Funded' AND vdocs:checklist/*/don = 0")).toEqual([
      '"vdocs:checklist/*/don": the entries of "vdocs:checklist" have no subfield "don", only "item", "done", "doneBy" and "doneOn", so Nuxeo refuses the query',
    ]);
    expect(
      nxqlNameProblems(
        "ecm:primaryType = 'VehicleTitle' AND vtitle:openOn < NOW('-P31D')",
        { pattern: false },
        model,
      ),
    ).toEqual([
      '"vtitle:openOn" is not a property of the schema "vehicletitle" (vtitle:) in the content model, so Nuxeo refuses the query',
    ]);
  });

  it("finds a prefix no schema has, a subfield of a simple property, and another type's property", () => {
    expect(missing("vdeals:status = 'Funded'")).toEqual([
      `"vdeals:status": no schema of the content model is written "vdeals:", by its prefix or its name, and the model's "vdeal:" is near it: a misspelling, which Nuxeo refuses`,
    ]);
    expect(missing("vdeal:status/code = 'x'")).toEqual([
      '"vdeal:status/code": "vdeal:status" is a string property, with no subfield "code", so Nuxeo refuses the query',
    ]);
    expect(missing("vtitle:status = 'Issued'")).toEqual([
      '"vtitle:status" is a property of the schema "vehicletitle", which the type "VehicleDeal" the page provider lists does not have, nor a facet of the model: no record it lists has it',
    ]);
  });

  it('finds a type and a facet neither the model nor Nuxeo has, each a near miss of one they have', () => {
    expect(
      nxqlNameProblems(
        "SELECT * FROM VehicleDeals WHERE vdeal:status = 'Funded'",
        { pattern: true },
        model,
      ),
    ).toEqual([
      `the type "VehicleDeals" is not in the content model, and the model's "VehicleDeal" is near it: a misspelling, so Nuxeo refuses a query from it`,
    ]);
    expect(
      nxqlNameProblems(
        "ecm:primaryType IN ('VehicleDeal', 'vehicleTitle') AND ecm:mixinType <> 'HidenInNavigation'",
        { pattern: false },
        model,
      ),
    ).toEqual([
      `the type "vehicleTitle" is not in the content model, and the model's "VehicleTitle" is near it: a misspelling, so the query lists no record of it`,
      `the facet "HidenInNavigation" is not in the content model, and Nuxeo's own "HiddenInNavigation" is near it: a misspelling, so no record has it`,
    ]);
  });

  const passed: [string, string][] = [
    ['a checklist entry by its index', 'vdocs:checklist/0/done = 1'],
    ['a first matching entry, and a parameter', 'vdocs:checklist/*1/item = ?'],
    [
      "a file's name, in Nuxeo's files schema the model describes",
      "files:files/*/file/name LIKE '%.pdf'",
    ],
    [
      "a property written with its schema's name, as Nuxeo reads one too",
      "vehicledeal:status = 'Funded'",
    ],
    [
      "a property of one of Nuxeo's own schemas the model does not describe",
      "file:content/name IS NOT NULL AND nxtag:tags = 'x'",
    ],
    [
      "the server's own properties, and a named parameter",
      'ecm:fulltext.dc:title = :text AND ecm:isTrashed = 0',
    ],
    [
      "Nuxeo's own types and facets",
      "ecm:mixinType NOT IN ('HiddenInNavigation', 'Folderish') AND ecm:primaryType <> 'File'",
    ],
    ['a string that holds a colon, which is no property', "vdeal:notes = 'a:b/c'"],
    [
      "an add-on's type, facet and schema, near none the model or Nuxeo's lists have",
      "ecm:primaryType <> 'LetterTemplate' AND ecm:mixinType <> 'Correspondence' AND letter:status = 'sent'",
    ],
    ["the user profile's schema, one of Nuxeo's own", 'userprofile:avatar IS NULL'],
    [
      "short prefixes an edit from the model's or Nuxeo's, which may be an add-on's",
      "doc:status = 'x' AND nx:flag = 1 AND rnd:kind = 'y'",
    ],
  ];
  it.each(passed)('passes %s', (_, where) => {
    expect(missing(where)).toEqual([]);
  });

  it('reads the types a pattern lists, and nothing after them', () => {
    expect(
      nxqlNameProblems(
        'SELECT * FROM VehicleDeal, VehicleTitle LIMIT 10',
        { pattern: true },
        model,
      ),
    ).toEqual([]);
    expect(
      nxqlNameProblems('SELECT * FROM VehicleDeal, VehicleTitel', { pattern: true }, model),
    ).toEqual([
      `the type "VehicleTitel" is not in the content model, and the model's "VehicleTitle" is near it: a misspelling, so Nuxeo refuses a query from it`,
    ]);
  });

  it('takes as written a complex value whose subfields the model does not give', () => {
    const reading = readContentModel({
      doctypes: { Party: { parent: 'Document', facets: [], schemas: ['party'] } },
      facets: [],
      schemas: [
        {
          name: 'party',
          prefix: 'pty',
          fields: { address: 'complex', contacts: { type: 'complex[]' } },
        },
      ],
    });
    if (!reading.model) throw new Error(reading.problems.join('; '));
    expect(propertyNameProblem('pty:address/street', reading.model, 'Party')).toBeNull();
    expect(propertyNameProblem('pty:contacts/*/email', reading.model, 'Party')).toBeNull();
  });

  it('passes a list of texts, item by item', () => {
    expect(
      nxqlNameProblems(
        "ecm:primaryType = 'DamageClaim' AND dmg:items/* = 'x'",
        { pattern: false },
        modelOf('moves-demo'),
      ),
    ).toEqual([]);
  });

  it("passes every kit's own page providers, sorts and aggregates, against the kit's own model", () => {
    let read = 0;
    for (const kit of readdirSync(KITS)) {
      const components = join(KITS, kit, 'bundle', 'OSGI-INF');
      if (!existsSync(components) || !existsSync(join(KITS, kit, 'content-model.json'))) continue;
      const own = modelOf(kit);
      for (const file of readdirSync(components).filter((name) => name.endsWith('.xml'))) {
        const xml = withoutComments(readFileSync(join(components, file), 'utf8'));
        for (const [, element, text] of xml.matchAll(
          /<(pattern|fixedPart)[^>]*>([\s\S]*?)<\/\1>/g,
        )) {
          read++;
          const nxql = text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
          expect(
            nxqlNameProblems(nxql, { pattern: element === 'pattern' }, own),
            `${kit}/${file}`,
          ).toEqual([]);
        }
        for (const [, column] of xml.matchAll(
          /<(?:sort column|aggregate [^>]*parameter)="([^"]+)"/g,
        ))
          expect(propertyNameProblem(column, own), `${kit}/${file}: ${column}`).toBeNull();
      }
    }
    expect(read).toBeGreaterThanOrEqual(21);
  });
});

describe('positionalParameters and parameterFindings: what a list gives a page provider', () => {
  it('counts the ? of a query, and none when it names a parameter, holds a ? in a string, or leaves a string open', () => {
    expect(positionalParameters("ecm:primaryType = 'A' AND a:b = ? AND a:c IN (?, ?)")).toBe(3);
    expect(positionalParameters("ecm:primaryType = 'A' AND a:b = 'x'")).toBe(0);
    expect(positionalParameters('a:b = :value AND a:c = ?')).toBeNull();
    expect(positionalParameters('a:b =:value AND a:c = ?')).toBeNull();
    expect(positionalParameters("a:b LIKE '%?%' AND a:c = ?")).toBeNull();
    expect(positionalParameters("a:b = 'open")).toBeNull();
  });

  const providers = new Map([
    ['one', { component: 'OSGI-INF/kit-model.xml', parameters: 1 }],
    ['none', { component: 'OSGI-INF/kit-model.xml', parameters: 0 }],
    ['named', { component: 'OSGI-INF/kit-model.xml', parameters: null }],
  ]);
  const at = (path: string, content: unknown) =>
    parameterFindings(path, content, providers).map(
      (finding) => `${finding.path}: ${finding.message}`,
    );

  it('finds a queue that gives too few, a search with no ? of its own, and a figure and a related list giving too many', () => {
    expect(at('queues/q.json', { pageProvider: 'one' })).toEqual([
      'pageProvider: the page provider "one" (OSGI-INF/kit-model.xml) takes 1 parameter, each a ? filled in order, and the queue gives 0: with fewer, the query fails on the server, or runs otherwise than it is written',
    ]);
    expect(
      at('queues/q.json', { pageProvider: 'one', parameters: ['x'], search: { label: 'Find' } }),
    ).toEqual([
      `parameters: the page provider "one" (OSGI-INF/kit-model.xml) takes 1 parameter, each a ? filled in order, and the queue gives 2, its search's text last: with more, the query fails on the server, or runs otherwise than it is written`,
    ]);
    expect(
      at('home.json', { cards: [{ id: 'a', kpi: { pageProvider: 'none', parameters: ['x'] } }] }),
    ).toEqual([
      'cards[0].kpi.parameters: the page provider "none" (OSGI-INF/kit-model.xml) takes 0 parameters, each a ? filled in order, and the figure gives 1: with more, the query fails on the server, or runs otherwise than it is written',
    ]);
    expect(
      at('layouts/A/view.layout.json', {
        tabs: [
          {
            cards: [
              {
                id: 'r',
                related: { pageProvider: 'one', parameters: [{ field: 'ecm:uuid' }, 'x'] },
              },
            ],
          },
        ],
      }),
    ).toEqual([
      'tabs[0].cards[0].related.parameters: the page provider "one" (OSGI-INF/kit-model.xml) takes 1 parameter, each a ? filled in order, and the related list gives 2: with more, the query fails on the server, or runs otherwise than it is written',
    ]);
  });

  it("passes what fills them, a search's text the last, and the server's page providers", () => {
    expect(at('queues/q.json', { pageProvider: 'one', search: { label: 'Find' } })).toEqual([]);
    expect(at('queues/q.json', { pageProvider: 'one', parameters: ['$currentUser'] })).toEqual([]);
    expect(at('queues/q.json', { pageProvider: 'named' })).toEqual([]);
    expect(at('queues/q.json', { pageProvider: 'default_search', parameters: ['x'] })).toEqual([]);
    expect(at('queues/q.json', { pageProvider: 'none', parameters: 'not a list' })).toEqual([]);
  });
});
