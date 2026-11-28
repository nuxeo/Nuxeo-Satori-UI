/**
 * What M2 left over (docs/business-apps/studio-migration.md, "Where M2 stands"), on the made-up
 * package with M2's corpus and its leftovers (`testing/m2-leftovers-corpus.ts`):
 *
 * - a tab whose page is a list becomes a card of related records of the type's record page, over
 *   the same page provider, with the open record as its parameter where the page passes it;
 * - the `edit` and `create` forms are written in version 2, so that a field or a layout block
 *   under a condition there carries its rule;
 * - a condition on a version 1 field, a list's column or a search screen's table travels as a rule
 *   where the file can hold it, and is reported where it cannot, never shown to everyone;
 * - the dashboard's tasks card becomes a card of the person's tasks, and its recently viewed card a
 *   proposal, written only once a person accepts it.
 *
 * The controls of each are in `mutations.ts`, `LEFTOVER_MUTATIONS`, applied by harness.spec.ts to
 * this corpus with every other control; this spec names what each broke.
 */
import { loadCatalogue } from './catalogue';
import { constructsOf, identitiesOf, sharedIdentities } from './constructs';
import {
  convert,
  convertWithDecisions,
  packageBuildOf,
  type Conversion,
  type ReportEntry,
} from './convert';
import { reportSummary } from './cli';
import { listingParameters, listingSort } from './convert-tabs';
import { decisionsFor, holdDecisions, type DecisionsFile } from './decisions';
import { runCheck, runHarness, type HarnessInput } from './harness';
import { inventory } from './inventory';
import { MUTATIONS, ruleHolders } from './mutations';
import { summarise } from './report';
import { readStudioPackage } from './studio-package';
import { m2AllFiles } from './testing/m2-leftovers-corpus';
import { syntheticPackage } from './testing/synthetic-package';

const UI = 'web/nuxeo.war/ui';
const catalogue = loadCatalogue();
const ALLOW_LIST: ReadonlySet<string> = new Set(['Claim.Approve']);

const VEHICLES = `${UI}/nuxeo-Acme-Claims-vehicles-bundle.html`;
const EDIT = `${UI}/document/vehicle/nuxeo-vehicle-edit-layout.html`;
const CREATE = `${UI}/document/vehicle/nuxeo-vehicle-create-layout.html`;
const METADATA = `${UI}/document/vehicle/nuxeo-vehicle-metadata-layout.html`;
const RESULTS = `${UI}/search/vehicles/nuxeo-vehicles-search-results.html`;
const HOME = `${UI}/nuxeo-home.html`;
const RECENT = `dashboard-card:${HOME}#4`;

function prepare(bundle: Record<string, string> = m2AllFiles()): HarnessInput {
  const pkg = readStudioPackage(syntheticPackage({ bundle }));
  const read = inventory(pkg);
  return {
    pkg,
    inventory: read,
    catalogue,
    allowList: ALLOW_LIST,
    conversion: convert(pkg, read, catalogue, { allowList: ALLOW_LIST }),
  };
}

const run = (input: HarnessInput, number: number) => runCheck(input, number);

const entry = (conversion: Conversion, id: string): ReportEntry | undefined =>
  conversion.report.constructs.find((candidate) => candidate.id === id);

// The tests reach into a file as the JSON it is; typing each shape would only restate it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function edit(input: HarnessInput, path: string, change: (file: any) => unknown): HarnessInput {
  const file = JSON.parse(JSON.stringify(input.conversion.app[path] ?? null));
  const changed = change(file);
  const app: Record<string, unknown> = { ...input.conversion.app };
  if (changed === undefined) delete app[path];
  else app[path] = changed;
  return { ...input, conversion: { ...input.conversion, app } };
}

/** The tab of Vehicle's view file with the given id. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const vehicleTab = (conversion: Conversion, id: string): any =>
  (conversion.app['layouts/Vehicle/view.layout.json'] as { tabs?: { id: string }[] }).tabs?.find(
    (tab) => tab.id === id,
  );

const inGroup = (group: string) => ({ type: 'app.rules.inGroup', parameters: [group] });
const vehicle = { type: 'app.rules.isType', parameters: ['Vehicle'] };

const corpus = prepare();

describe('a tab whose page is a list', () => {
  it('reads the list in the element the page is: its page provider, views, columns and conditions', () => {
    const page = corpus.inventory.slotContributions.find(
      (contribution) => contribution.name === 'vehicle-claims-page',
    );
    expect(page?.pageNames).toEqual(['claims']);
    expect(page?.listing).toMatchObject({
      element: 'div',
      providers: [
        {
          provider: 'vehicle_claims',
          params: '{"queryParams": "[[document.uid]]"}',
          pageSize: '20',
          sort: '{"dc:modified": "desc"}',
        },
      ],
      views: ['nuxeo-data-table'],
      others: [],
    });
    expect(page?.listing?.columns.map((column) => [column.field, column.conditional])).toEqual([
      ['dc:title', false],
      ['cl:amount', false],
      ['cl:incidentDate', false],
      ['cl:reserve', true],
    ]);
    // The page's own condition is around the element the page is, not around a column of it.
    expect(page?.conditions).toHaveLength(1);
  });

  it("becomes a card of related records of the type's record page, over the same page provider and the open record", () => {
    const tab = vehicleTab(corpus.conversion, 'claims');
    expect(tab).toEqual({
      id: 'claims',
      labelKey: 'label.tab.claims',
      visibleWhen: { type: 'core.every', parameters: [vehicle, vehicle] },
      cards: [
        {
          id: 'claims.records',
          related: {
            pageProvider: 'vehicle_claims',
            parameters: [{ field: 'ecm:uuid' }],
            columns: [
              { field: 'dc:title', label: 'Title' },
              { field: 'cl:amount', label: 'Amount' },
              { field: 'cl:incidentDate', label: 'Incident', widget: 'relative-date' },
              {
                field: 'cl:reserve',
                label: 'Reserve',
                visibleWhen: { type: 'core.every', parameters: [inGroup('adjusters'), vehicle] },
              },
            ],
            sort: [{ field: 'dc:modified', order: 'desc' }],
            pageSize: 20,
          },
        },
      ],
    });
    for (const index of [1, 2])
      expect(entry(corpus.conversion, `slot-contribution:${VEHICLES}#${index}`)).toMatchObject({
        outcome: 'converted',
        to: 'layouts/Vehicle/view.layout.json tabs.claims',
      });
  });

  it('reports a list whose page provider takes a named parameter, and writes no tab of it', () => {
    expect(vehicleTab(corpus.conversion, 'inspections')).toBeUndefined();
    for (const index of [3, 4])
      expect(entry(corpus.conversion, `slot-contribution:${VEHICLES}#${index}`)).toMatchObject({
        outcome: 'reported',
        note: expect.stringMatching(/named parameters \(vehicleId\)/),
      });
  });

  it('writes a list without its grid view and a column whose test reads each row, and reports the tab', () => {
    expect(vehicleTab(corpus.conversion, 'documents').cards[0].related.columns).toEqual([
      { field: 'dc:title', label: 'Title' },
    ]);
    expect(entry(corpus.conversion, `slot-contribution:${VEHICLES}#5`)).toMatchObject({
      outcome: 'reported',
      to: 'layouts/Vehicle/view.layout.json tabs.documents',
      note: expect.stringMatching(
        /^Written without what Web UI's page shows of its list: its nuxeo-data-grid view: a card of related records is a table; its column 2, dc:description, is left out: .*document \[\[item\]\]/,
      ),
    });
  });

  it('reads the open record as a parameter only when the page binds it whole, and refuses the rest', () => {
    expect(listingParameters('{"queryParams": ["open", "[[document.uid]]"]}')).toEqual({
      parameters: ['open', { field: 'ecm:uuid' }],
    });
    expect(
      listingParameters(
        '{"queryParams": ["{{document.path}}", "[[document.type]]", "[[ document.state ]]", "[[document.properties.cl:number]]"]}',
      ),
    ).toEqual({
      parameters: [
        { field: 'ecm:path' },
        { field: 'ecm:primaryType' },
        { field: 'ecm:currentLifeCycleState' },
        { field: 'cl:number' },
      ],
    });
    expect(listingParameters(null)).toEqual({ parameters: [] });
    // Text around a binding sends another value; another path of the page, or none, is no record.
    for (const params of [
      '{"queryParams": " [[document.uid]]"}',
      '{"queryParams": "x-[[document.uid]]"}',
      '{"queryParams": "[[document.title]]"}',
      '{"queryParams": "[[item.uid]]"}',
      '{"queryParams": "[[_id(document)]]"}',
    ])
      expect(listingParameters(params)).toEqual({
        problem: expect.stringMatching(
          /is bound to the page in a way a list of related records cannot send/,
        ),
      });
    expect(listingParameters('{"queryParams": 3}')).toEqual({
      problem: 'its query parameter 3 is not text',
    });
    expect(listingParameters('{"vehicleId": "[[document.uid]]"}')).toEqual({
      problem: expect.stringMatching(/named parameters \(vehicleId\)/),
    });
    expect(listingParameters('[[params]]')).toEqual({
      problem: expect.stringMatching(/are not JSON/),
    });
    expect(listingParameters('[]')).toEqual({ problem: expect.stringMatching(/not an object/) });
  });

  it('reads its sort as written, and refuses one it cannot read', () => {
    expect(listingSort('{"dc:modified": "desc", "dc:title": "ASC"}')).toEqual({
      sort: [
        { field: 'dc:modified', order: 'desc' },
        { field: 'dc:title', order: 'asc' },
      ],
    });
    expect(listingSort(null)).toEqual({ sort: [] });
    for (const sort of ['[[sort]]', '{"dc:modified": "newest"}', '{"modified": "desc"}', '[]'])
      expect(listingSort(sort)).toHaveProperty('problem');
  });

  it('reports a page that holds more than a list, two page providers, no table, or no column it can write', () => {
    const page = (inner: string) => ({
      ...m2AllFiles(),
      [VEHICLES]: `<nuxeo-slot-content name="vehicle-x-item" slot="DOCUMENT_VIEWS_ITEMS" order="20">
  <template><nuxeo-filter document="[[document]]" type="Vehicle"><template><nuxeo-page-item name="x" label="X"></nuxeo-page-item></template></nuxeo-filter></template>
</nuxeo-slot-content>
<nuxeo-slot-content name="vehicle-x-page" slot="DOCUMENT_VIEWS_PAGES">
  <template><nuxeo-filter document="[[document]]" type="Vehicle"><template><div name="x">${inner}</div></template></nuxeo-filter></template>
</nuxeo-slot-content>`,
    });
    const provider =
      '<nuxeo-page-provider id="p" provider="vehicle_claims" params=\'{"queryParams": "[[document.uid]]"}\'></nuxeo-page-provider>';
    const column =
      '<nuxeo-data-table-column name="Title" field="dc:title"></nuxeo-data-table-column>';
    const table = `<nuxeo-data-table nx-provider="p">${column}</nuxeo-data-table>`;
    const cases: [string, RegExp][] = [
      [
        `${provider}${table}<nuxeo-operation-button operation="Claim.Approve"></nuxeo-operation-button>`,
        /holds nuxeo-operation-button besides its list/,
      ],
      [`${provider}${provider}${table}`, /holds 2 page providers/],
      [`${table}`, /a table and no page provider/],
      [
        `${provider}<nuxeo-data-grid></nuxeo-data-grid>`,
        /shown as nuxeo-data-grid, and a card of related records is a table/,
      ],
      [`${provider}${table}${table}`, /holds 2 tables of one page provider/],
      [
        `${provider}<nuxeo-data-table nx-provider="p"><nuxeo-data-table-column name="Nothing"></nuxeo-data-table-column></nuxeo-data-table>`,
        /None of its list's columns can be written/,
      ],
      [
        `<nuxeo-page-provider id="p" provider="vehicle_claims" params='{"queryParams": "[[document.title]]"}'></nuxeo-page-provider>${table}`,
        /cannot send/,
      ],
      [
        `<nuxeo-page-provider id="p" provider="vehicle_claims" params='{"queryParams": "\\u005b\\u005bdocument.uid\\u005d\\u005d"}'></nuxeo-page-provider>${table}`,
        /reads as a binding only once its JSON escapes are read/,
      ],
      [
        `<nuxeo-page-provider id="p" provider="vehicle_claims" sort="[[sort]]"></nuxeo-page-provider>${table}`,
        /its page provider's sort, \[\[sort\]\], is not JSON/,
      ],
      [`<nuxeo-page-provider id="p"></nuxeo-page-provider>${table}`, /names no provider/],
      [
        `${provider}<nuxeo-filter document="[[document]]" path="/x"><template>${table}</template></nuxeo-filter>`,
        /no rule reads a path/,
      ],
      // Its table must list its page provider's records, named by its id.
      [
        `${provider}<nuxeo-data-table nx-provider="other">${column}</nuxeo-data-table>`,
        /does not name its page provider, p, as the one it lists/,
      ],
      [
        `${provider}<nuxeo-data-table items="[[document.properties.ve:history]]">${column}</nuxeo-data-table>`,
        /does not name its page provider, p, as the one it lists, by nx-provider, and is given items/,
      ],
      [
        `<nuxeo-page-provider provider="vehicle_claims"></nuxeo-page-provider>${table}`,
        /does not name its page provider as the one it lists/,
      ],
      // What else its page provider is given may list other records.
      [
        `<nuxeo-page-provider id="p" provider="vehicle_claims" quick-filters='[{"name":"openOnly","active":true}]'></nuxeo-page-provider>${table}`,
        /is given quick-filters, which a card of related records does not send/,
      ],
      [
        `<nuxeo-page-provider id="p" provider="vehicle_claims" query="SELECT * FROM Claim"></nuxeo-page-provider>${table}`,
        /is given query/,
      ],
    ];
    for (const [inner, note] of cases) {
      const input = prepare(page(inner));
      expect([inner, vehicleTab(input.conversion, 'x')]).toEqual([inner, undefined]);
      expect([inner, entry(input.conversion, `slot-contribution:${VEHICLES}#2`)]).toEqual([
        inner,
        expect.objectContaining({ outcome: 'reported', note: expect.stringMatching(note) }),
      ]);
    }
  });

  it('gives the card the rule of a condition inside the page around its list, and holds it there', () => {
    const files = m2AllFiles();
    const input = prepare({
      ...files,
      [VEHICLES]: files[VEHICLES].replace(
        '<nuxeo-data-table nx-provider="claimsProvider">',
        '<nuxeo-filter user="[[user]]" group="adjusters"><template><nuxeo-data-table nx-provider="claimsProvider">',
      ).replace(
        '</nuxeo-data-table>\n        </div>',
        '</nuxeo-data-table></template></nuxeo-filter>\n        </div>',
      ),
    });
    const card = vehicleTab(input.conversion, 'claims').cards[0];
    expect(card.visibleWhen).toEqual({
      type: 'core.every',
      parameters: [inGroup('adjusters'), vehicle],
    });
    for (const number of [2, 5, 6, 7, 10]) expect(run(input, number)?.findings).toEqual([]);
    const widened = edit(input, 'layouts/Vehicle/view.layout.json', (file) => {
      delete file.tabs[1].cards[0].visibleWhen;
      return file;
    });
    expect(run(widened, 5)?.findings).toEqual([
      "layouts/Vehicle/view.layout.json: its card claims.records shows the list of the tab claims to everyone who sees the tab, though Web UI's page shows the list only while a condition passes",
    ]);
  });

  it('writes a list asking a page size a card of related records cannot, asking its own, and reports the tab', () => {
    const files = m2AllFiles();
    const input = prepare({
      ...files,
      [VEHICLES]: files[VEHICLES].replace('page-size="20"', 'page-size="500"'),
    });
    expect(vehicleTab(input.conversion, 'claims').cards[0].related).not.toHaveProperty('pageSize');
    expect(entry(input.conversion, `slot-contribution:${VEHICLES}#1`)).toMatchObject({
      outcome: 'reported',
      to: 'layouts/Vehicle/view.layout.json tabs.claims',
      note: expect.stringMatching(/its page size, 500, is not one a list of related records takes/),
    });
    for (const number of [2, 7]) expect(run(input, number)?.findings).toEqual([]);
  });
});

describe('the edit and create forms in version 2', () => {
  it('give a field and a layout block under a condition their rules, as the view does', () => {
    expect(corpus.conversion.app['layouts/Vehicle/edit.layout.json']).toEqual({
      version: 2,
      cards: [
        {
          id: 'fields',
          fields: [
            { field: 've:plate', label: 'Plate', required: true },
            { field: 've:make', label: 'Make' },
            {
              field: 've:mileage',
              label: 'Mileage',
              required: true,
              visibleWhen: inGroup('inspectors'),
            },
          ],
        },
        {
          id: 'acme-vehicle-keeper',
          visibleWhen: { type: 'app.rules.hasFacet', parameters: ['Versionable'] },
          fields: [
            { field: 've:keeper', label: 'Keeper', widget: 'user' },
            { field: 've:notes', label: 'Notes', widget: 'long-text' },
          ],
        },
      ],
    });
    expect(corpus.conversion.app['layouts/Vehicle/create.layout.json']).toEqual({
      version: 2,
      cards: [
        {
          id: 'fields',
          fields: [
            { field: 've:plate', label: 'Plate', required: true },
            {
              field: 've:inspector',
              label: 'Inspector',
              widget: 'user',
              visibleWhen: inGroup('inspectors'),
            },
          ],
        },
      ],
    });
    expect(entry(corpus.conversion, `condition:${EDIT}#1`)).toMatchObject({
      outcome: 'converted',
      to: 'the visibleWhen of layouts/Vehicle/edit.layout.json ve:mileage',
    });
    expect(entry(corpus.conversion, `condition:${CREATE}#1`)).toMatchObject({
      outcome: 'converted',
    });
  });

  it('reports a field of the metadata layout under a condition, which version 1 cannot hold, and its condition', () => {
    expect(corpus.conversion.app['layouts/Vehicle/metadata.layout.json']).toEqual({
      version: 1,
      sections: [{ id: 'fields', fields: [{ field: 've:plate', label: 'Plate' }] }],
    });
    expect(entry(corpus.conversion, `layout-field:${METADATA}#2`)).toMatchObject({
      outcome: 'reported',
      note: expect.stringMatching(
        /version 1 has no rules: the app reads its metadata layout in version 1 alone/,
      ),
    });
    expect(entry(corpus.conversion, `condition:${METADATA}#1`)).toMatchObject({
      outcome: 'reported',
      note: expect.stringMatching(/nothing it guards carries it, and nothing will/),
    });
  });
});

describe('conditions on list columns and search tables', () => {
  it("gives a search screen's queue its table's rule, and a column its own, where they read the user only", () => {
    expect(corpus.conversion.app['queues/vehicles.json']).toMatchObject({
      visibleWhen: inGroup('fleet'),
      columns: [
        { field: 've:plate' },
        { field: 've:make' },
        {
          field: 've:mileage',
          visibleWhen: {
            type: 'core.every',
            parameters: [inGroup('inspectors'), inGroup('fleet')],
          },
        },
      ],
    });
    expect(entry(corpus.conversion, `search-column:${RESULTS}#4`)).toMatchObject({
      outcome: 'reported',
      note: expect.stringMatching(/document \[\[item\]\]/),
    });
  });

  it("gives a dashboard card's column its rule, and reports the card for the column it leaves out", () => {
    expect(corpus.conversion.app['queues/home-5-vehicles.json']).toMatchObject({
      columns: [{ field: 've:plate' }, { field: 've:mileage', visibleWhen: inGroup('inspectors') }],
    });
    expect(entry(corpus.conversion, `dashboard-card:${HOME}#5`)).toMatchObject({
      outcome: 'reported',
      to: 'home.json card-5, its list in queues/home-5-vehicles.json',
      note: expect.stringMatching(/its column 3, ve:notes, is left out/),
    });
  });

  it('reports a table whose condition reads a document, where no record is open in a queue', () => {
    const files = m2AllFiles();
    const input = prepare({
      ...files,
      [RESULTS]: files[RESULTS].replace(
        '<nuxeo-filter user="[[user]]" group="fleet">',
        '<nuxeo-filter document="[[document]]" type="Vehicle">',
      ),
    });
    expect(input.conversion.app['queues/vehicles.json']).toBeUndefined();
    expect(entry(input.conversion, `search:${RESULTS}#search`)).toMatchObject({
      outcome: 'reported',
      note: expect.stringMatching(
        /condition on a document passes, and no record is open in a queue/,
      ),
    });
    for (const number of [2, 5, 7]) expect(run(input, number)?.findings).toEqual([]);
    // Written all the same, the queue is no list of the package: check 5 says it shows to all, and
    // check 7 that nothing of the package asks for it.
    const written = edit(input, 'queues/vehicles.json', () => ({
      version: 2,
      label: 'vehicles',
      pageProvider: 'vehicles',
      columns: ['ve:plate'],
    }));
    expect(run(written, 5)?.findings).toEqual([
      'queues/vehicles.json: it lists vehicles for everyone, though Web UI shows the table only while a condition passes',
    ]);
    expect(run(written, 7)?.findings).toEqual([
      'queues/vehicles.json: it asks for a list that no screen or card of the package asks for',
    ]);
  });

  it('reports a column whose condition reads a document, where no record is open in a queue', () => {
    const files = m2AllFiles();
    const input = prepare({
      ...files,
      [RESULTS]: files[RESULTS].replace(
        '<nuxeo-filter user="[[user]]" group="inspectors"><template>[[item.properties.ve:mileage]]',
        '<nuxeo-filter document="[[document]]" type="Vehicle"><template>[[item.properties.ve:mileage]]',
      ),
    });
    expect(entry(input.conversion, `search-column:${RESULTS}#3`)).toMatchObject({
      outcome: 'reported',
      note: expect.stringMatching(
        /condition on a document passes, and no record is open in a queue/,
      ),
    });
    expect(JSON.stringify(input.conversion.app['queues/vehicles.json'])).not.toContain(
      've:mileage',
    );
    for (const number of [2, 5]) expect(run(input, number)?.findings).toEqual([]);
  });

  it('keeps a property once, in the column that shows it to everyone, though another shows it under a rule', () => {
    const files = m2AllFiles();
    const input = prepare({
      ...files,
      [RESULTS]: files[RESULTS].replace(
        '<nuxeo-data-table-column name="Make" field="ve:make"></nuxeo-data-table-column>',
        '<nuxeo-data-table-column name="Make" field="ve:make"></nuxeo-data-table-column><nuxeo-data-table-column name="Mileage" field="ve:mileage"></nuxeo-data-table-column>',
      ),
    });
    expect(
      (input.conversion.app['queues/vehicles.json'] as { columns: unknown[] }).columns,
    ).toEqual([
      { field: 've:plate', label: 'Plate' },
      { field: 've:make', label: 'Make' },
      { field: 've:mileage', label: 'Mileage' },
    ]);
    expect(entry(input.conversion, `search-column:${RESULTS}#4`)).toMatchObject({
      outcome: 'reported',
      note: expect.stringMatching(/another column of the list shows it to everyone/),
    });
    for (const number of [2, 5, 6]) expect(run(input, number)?.findings).toEqual([]);
  });

  it('fails a queue that drops its table rule, and one that shows a column it leaves out', () => {
    const widened = edit(corpus, 'queues/vehicles.json', (file) => {
      delete file.visibleWhen;
      return file;
    });
    expect(run(widened, 5)?.findings).toEqual([
      'queues/vehicles.json: it lists vehicles for everyone, though Web UI shows the table only while a condition passes',
    ]);
    const shown = edit(corpus, 'queues/vehicles.json', (file) => {
      file.columns.push({ field: 've:notes', label: 'Notes' });
      return file;
    });
    expect(run(shown, 5)?.findings).toEqual([
      'queues/vehicles.json: it shows the column ve:notes to everyone, though Web UI shows it only while a condition passes',
    ]);
  });
});

describe("the dashboard's tasks and recently viewed cards", () => {
  it("makes each tasks card a card of the person's tasks, with its condition's rule", () => {
    expect(corpus.conversion.app['home.json']).toEqual({
      version: 2,
      cards: [
        { id: 'card-1', label: 'Open claims', queue: 'home-1-claims' },
        { id: 'card-3', label: 'My tasks', tasks: {} },
        { id: 'card-5', label: 'Fleet', queue: 'home-5-vehicles' },
        { id: 'card-6', label: 'Team tasks', tasks: {}, visibleWhen: inGroup('supervisors') },
      ],
    });
    expect(entry(corpus.conversion, `dashboard-card:${HOME}#3`)).toMatchObject({
      outcome: 'converted',
      to: 'home.json card-3',
    });
    for (const number of [5, 6, 7, 10]) expect(run(corpus, number)?.findings).toEqual([]);
  });

  it('fails a card of tasks narrowed to one workflow or a number, shown another way, or under no rule', () => {
    const narrowed = edit(corpus, 'home.json', (file) => {
      file.cards[1].tasks = { workflow: 'ClaimReview' };
      file.cards[3] = { id: 'card-6', label: 'Team tasks', queue: 'home-1-claims' };
      return file;
    });
    expect(run(narrowed, 7)?.findings).toEqual([
      'home.json: card-3 lists them as {"workflow":"ClaimReview"}, where Web UI\'s dashboard card 3 lists the person\'s tasks, as {}',
      'home.json: card-6 shows a link to "home-1-claims", where Web UI\'s dashboard card 6 lists the person\'s tasks',
    ]);
    const limited = edit(corpus, 'home.json', (file) => {
      file.cards[1].tasks = { limit: 1 };
      return file;
    });
    expect(run(limited, 7)?.findings).toEqual([
      'home.json: card-3 lists them as {"limit":1}, where Web UI\'s dashboard card 3 lists the person\'s tasks, as {}',
    ]);
    const widened = edit(corpus, 'home.json', (file) => {
      delete file.cards[3].visibleWhen;
      return file;
    });
    expect(run(widened, 5)?.findings).toEqual([
      'home.json: card-6 shows card 6 to everyone, though Web UI shows it only while a condition passes',
    ]);
  });

  it('proposes the recently viewed card as recent records, says why, and writes it nowhere', () => {
    expect(entry(corpus.conversion, RECENT)).toMatchObject({
      outcome: 'proposed',
      proposal: true,
      proposes: { id: 'card-4', label: 'Recently viewed', recent: {} },
      note: expect.stringMatching(
        /^Web UI's card lists the documents the person opened last.*the records the person created or edited last instead/,
      ),
    });
    expect(entry(corpus.conversion, RECENT)).not.toHaveProperty('applied');
    expect(runHarness(corpus).blockers).toContain(
      '3 proposals wait for a person to accept or reject them',
    );
    // The report a person reads says what accepting it writes, beside its reason.
    expect(reportSummary(summarise(corpus))).toMatch(
      new RegExp(
        `\\n {6}id: ${RECENT.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}\\n {6}why: Web UI's card lists[^\\n]*\\n {6}proposes: \\{"id":"card-4","label":"Recently viewed","recent":\\{\\}\\}\\n {6}decided: nothing yet\\n`,
      ),
    );
  });

  /** The decisions file, every reported item decided, and the recently viewed card as given. */
  function decided(input: HarnessInput, verdict: 'accept' | 'reject'): DecisionsFile {
    const { file } = decisionsFor(
      input.conversion.report,
      packageBuildOf(input.pkg),
      identitiesOf(input.inventory),
      sharedIdentities(constructsOf(input.inventory)),
    );
    return {
      ...file,
      decisions: file.decisions.map((item) =>
        item.id === RECENT
          ? { ...item, owner: 'Dana Reviewer', decision: verdict, reason: `Checked: ${verdict}` }
          : item.outcome === 'proposed'
            ? item
            : { ...item, owner: 'Migration lead', decision: 'Kept as reported' },
      ),
    };
  }

  /** The conversion `migrate --from` makes with a decisions file. */
  function convertedWith(input: HarnessInput, file: DecisionsFile): HarnessInput {
    const earlier = { raw: JSON.parse(JSON.stringify(file)) as unknown, file: 'earlier.json' };
    const conversion = convertWithDecisions(
      input.pkg,
      input.inventory,
      catalogue,
      { allowList: ALLOW_LIST },
      earlier,
    );
    const carried = decisionsFor(
      conversion.report,
      packageBuildOf(input.pkg),
      identitiesOf(input.inventory),
      sharedIdentities(constructsOf(input.inventory)),
      earlier,
    ).file;
    return { ...input, conversion: { ...conversion, decisions: carried } };
  }

  it('takes an acceptance of it, which a card that proposes nothing writable cannot take', () => {
    const held = holdDecisions(
      corpus.conversion.report,
      decided(corpus, 'accept'),
      packageBuildOf(corpus.pkg),
      identitiesOf(corpus.inventory),
    );
    expect(held.findings).toEqual([]);
    expect(held.verdicts.get(RECENT)).toMatchObject({ accepted: true });
    // The favourites card, which an operation feeds, proposes nothing written: refused accepted.
    const files = m2AllFiles();
    const favourites = prepare({
      ...files,
      [HOME]: files[HOME].replace(
        '<!-- <nuxeo-card heading="Retired">',
        '<nuxeo-card heading="Favourites"><nuxeo-operation op="Favorite.Fetch"></nuxeo-operation></nuxeo-card>\n      <!-- <nuxeo-card heading="Retired">',
      ),
    });
    const file = decided(favourites, 'accept');
    const card = `dashboard-card:${HOME}#7`;
    const both = {
      ...file,
      decisions: file.decisions.map((item) =>
        item.id === card
          ? { ...item, owner: 'Dana Reviewer', decision: 'accept', reason: 'Checked' }
          : item,
      ),
    };
    const refused = holdDecisions(
      favourites.conversion.report,
      both,
      packageBuildOf(favourites.pkg),
      identitiesOf(favourites.inventory),
    );
    expect(refused.findings).toEqual([
      `decisions.json: ${card} proposes nothing the converter can write yet, so it cannot be accepted: reject it, with your reason, or leave it for the mapping agent`,
    ]);
    expect(refused.verdicts.get(RECENT)).toMatchObject({ accepted: true });
  });

  it('writes it once a person accepts it, and holds the conversion to that decision', () => {
    const accepted = convertedWith(corpus, decided(corpus, 'accept'));
    expect(accepted.conversion.app['home.json']).toMatchObject({
      cards: [
        { id: 'card-1' },
        { id: 'card-3' },
        { id: 'card-4', label: 'Recently viewed', recent: {} },
        { id: 'card-5' },
        { id: 'card-6' },
      ],
    });
    expect(entry(accepted.conversion, RECENT)).toMatchObject({
      outcome: 'proposed',
      applied: 'accept',
      to: 'home.json card-4',
    });
    for (const number of [5, 6, 7, 10]) expect(run(accepted, number)?.findings).toEqual([]);
    const blockers = runHarness(accepted).blockers.join('\n');
    expect(blockers).not.toMatch(/decided otherwise than decisions\.json/);
    expect(blockers).not.toMatch(/report\.json says otherwise/);
    // Dropped from a conversion made with it, check 7 says the accepted card is missing.
    const dropped = edit(accepted, 'home.json', (file) => {
      file.cards = file.cards.filter((card: { id: string }) => card.id !== 'card-4');
      return file;
    });
    expect(run(dropped, 7)?.findings).toEqual([
      "home.json: card-4 is missing, though Web UI's dashboard card 4 is proposed as the person's recent records, which a person accepted",
    ]);
  });

  it('writes it nowhere once a person rejects it', () => {
    const rejected = convertedWith(corpus, decided(corpus, 'reject'));
    expect(JSON.stringify(rejected.conversion.app['home.json'])).not.toContain('recent');
    expect(entry(rejected.conversion, RECENT)).toMatchObject({
      outcome: 'proposed',
      applied: 'reject',
    });
    expect(entry(rejected.conversion, RECENT)).not.toHaveProperty('to');
    expect(run(rejected, 7)?.findings).toEqual([]);
  });

  it('is decided again when what it proposes changes', () => {
    const file = decided(corpus, 'accept');
    const changed = {
      ...corpus.conversion.report,
      constructs: corpus.conversion.report.constructs.map((construct) =>
        construct.id === RECENT
          ? { ...construct, proposes: { id: 'card-4', recent: { limit: 20 } } }
          : construct,
      ),
    };
    const held = holdDecisions(
      changed,
      file,
      packageBuildOf(corpus.pkg),
      identitiesOf(corpus.inventory),
    );
    expect(held.findings).toEqual([
      `decisions.json: ${RECENT} was made on another proposal than the report gives now, so it is not taken: decide it again`,
    ]);
    expect(held.verdicts.has(RECENT)).toBe(false);
  });
});

describe('the checks on what M2 left over', () => {
  it('pass on the conversion, with what needs the migration server in part', () => {
    expect(runHarness(corpus).checks.map((check) => [check.number, check.status])).toEqual([
      [1, 'pass'],
      [2, 'pass'],
      [3, 'partial'],
      [4, 'pass'],
      [5, 'partial'],
      [6, 'partial'],
      [7, 'partial'],
      [8, 'pass'],
      [9, 'pass'],
      [10, 'pass'],
    ]);
    expect(runHarness(corpus).blockers).not.toContainEqual(
      expect.stringMatching(/pending a later phase/),
    );
  });

  describe("name what each of the leftovers' controls broke", () => {
    it.each<[string, readonly string[]]>([
      [
        'drop-listing-card',
        [
          "layouts/Vehicle/view.layout.json tab claims: its card of related records claims.records is missing, though Web UI's tab claims, which lists vehicle_claims",
        ],
      ],
      [
        'wrong-listing-provider',
        [
          'layouts/Vehicle/view.layout.json tab claims: it asks the page provider "vehicle_claims_other", where Web UI\'s tab claims asks vehicle_claims',
        ],
      ],
      [
        'drop-listing-parameter',
        [
          'layouts/Vehicle/view.layout.json tab claims: it sends the parameters [], where Web UI\'s tab claims sends [{"field":"ecm:uuid"}]',
        ],
      ],
      [
        'drop-form-field-rule',
        [
          'layouts/Policy/edit.layout.json: it shows po:premium of the layout block acme-policy-summary to everyone, though Web UI shows it only while condition 1 passes',
        ],
      ],
      [
        'drop-column-rule',
        [
          'layouts/Vehicle/view.layout.json tab claims: it shows the column cl:reserve to everyone, though Web UI shows it only while a condition passes',
        ],
      ],
      [
        'convert-recent-undecided',
        [
          "home.json: card-4 lists the person's recent records, which only a person accepting the card proposed for Web UI's recently viewed card 4 writes, and no one has",
        ],
      ],
      [
        'drop-tasks-card',
        ["home.json: card-3 is missing, though Web UI's dashboard card 3 lists the person's tasks"],
      ],
    ])('%s', (name, expected) => {
      const mutation = MUTATIONS.find((candidate) => candidate.name === name);
      if (!mutation) throw new Error(name);
      const broken = mutation.apply(corpus.conversion, corpus).conversion;
      expect(run({ ...corpus, conversion: broken }, mutation.caughtBy)?.findings).toEqual(expected);
    });
  });

  it('fail a listing dropped whole, and a card of related records no tab gives', () => {
    const dropped = edit(corpus, 'layouts/Vehicle/view.layout.json', (file) => {
      file.tabs = file.tabs.filter((tab: { id: string }) => tab.id !== 'claims');
      return file;
    });
    expect(run(dropped, 2)?.findings).toEqual([
      "layouts/Vehicle/view.layout.json: its tab claims is missing, though Web UI's tab claims, which lists vehicle_claims",
    ]);
    const invented = edit(corpus, 'layouts/Vehicle/view.layout.json', (file) => {
      file.tabs[0].cards.push({
        id: 'extra',
        related: { pageProvider: 'vehicles', columns: ['ve:plate'] },
      });
      return file;
    });
    expect(run(invented, 7)?.findings).toEqual([
      'layouts/Vehicle/view.layout.json: the card extra lists "vehicles" as related records, which no tab of the package lists',
    ]);
    // In the tab, beside its own card, it is check 2's too.
    const beside = edit(corpus, 'layouts/Vehicle/view.layout.json', (file) => {
      file.tabs[1].cards.push({
        id: 'claims.more',
        related: { pageProvider: 'vehicles', columns: ['ve:plate'] },
      });
      return file;
    });
    expect(run(beside, 2)?.findings).toEqual([
      "layouts/Vehicle/view.layout.json tab claims: it shows the card claims.more, which Web UI's tab claims, which lists vehicle_claims does not",
    ]);
  });

  it('fail a listing whose column, sort or page size is not what Web UI asks', () => {
    const changed = edit(corpus, 'layouts/Vehicle/view.layout.json', (file) => {
      const related = file.tabs[1].cards[0].related;
      related.columns.reverse();
      related.sort = [];
      related.pageSize = 50;
      return file;
    });
    expect(run(changed, 2)?.findings).toEqual([
      'layouts/Vehicle/view.layout.json tab claims: its columns are in the order cl:reserve, cl:incidentDate, cl:amount, dc:title, not dc:title, cl:amount, cl:incidentDate, cl:reserve',
    ]);
    expect(run(changed, 7)?.findings).toEqual([
      'layouts/Vehicle/view.layout.json tab claims: it sorts by [], where Web UI\'s tab claims opens sorted by [{"field":"dc:modified","order":"desc"}]',
      "layouts/Vehicle/view.layout.json tab claims: it asks for pages of 50, where Web UI's tab claims asks for 20",
    ]);
  });

  it('fail a related column moved under another rule, or named otherwise than Web UI', () => {
    const moved = edit(corpus, 'layouts/Vehicle/view.layout.json', (file) => {
      file.tabs[1].cards[0].related.columns[3].visibleWhen = inGroup('everyone');
      return file;
    });
    expect(run(moved, 5)?.findings).toEqual([
      expect.stringMatching(
        /^layouts\/Vehicle\/view\.layout\.json: tabs\.1\.cards\.0\.related\.columns\.3\.visibleWhen decides otherwise than Web UI's condition/,
      ),
    ]);
    const renamed = edit(corpus, 'layouts/Vehicle/view.layout.json', (file) => {
      file.tabs[1].cards[0].related.columns[1].label = 'Sum';
      return file;
    });
    expect(run(renamed, 6)?.findings).toEqual([
      'layouts/Vehicle/view.layout.json: the tab claims\'s column cl:amount: the app shows "Sum", where Web UI shows "Amount"',
    ]);
  });

  /** Every rule the conversion carries in what M2 left over. */
  const LEFTOVER_RULES = [
    'layouts/Policy/edit.layout.json cards.1.fields.2.visibleWhen',
    'layouts/Vehicle/create.layout.json cards.0.fields.1.visibleWhen',
    'layouts/Vehicle/edit.layout.json cards.1.visibleWhen',
    'layouts/Vehicle/edit.layout.json cards.0.fields.2.visibleWhen',
    'layouts/Vehicle/view.layout.json tabs.1.visibleWhen',
    'layouts/Vehicle/view.layout.json tabs.2.visibleWhen',
    'layouts/Vehicle/view.layout.json tabs.1.cards.0.related.columns.3.visibleWhen',
    'queues/home-5-vehicles.json columns.1.visibleWhen',
    'queues/vehicles.json visibleWhen',
    'queues/vehicles.json columns.2.visibleWhen',
    'home.json cards.3.visibleWhen',
  ];
  const leftovers = () =>
    ruleHolders(corpus.conversion).filter((found) =>
      LEFTOVER_RULES.includes(`${found.path} ${found.at}`),
    );

  it('find every rule of the leftovers the cases below break', () => {
    expect(
      leftovers()
        .map((found) => `${found.path} ${found.at}`)
        .sort(),
    ).toEqual([...LEFTOVER_RULES].sort());
  });

  describe.each(['dropped', 'inverted'] as const)(
    'fail on every rule of the leftovers %s, one by one',
    (change) => {
      it.each(LEFTOVER_RULES)('%s', (where) => {
        const found = leftovers().find((holder) => `${holder.path} ${holder.at}` === where);
        if (!found) throw new Error(`no rule at ${where}`);
        if (change === 'dropped') delete found.holder['visibleWhen'];
        else
          found.holder['visibleWhen'] = {
            type: 'core.not',
            parameters: [found.holder['visibleWhen']],
          };
        const broken = {
          ...corpus,
          conversion: {
            ...corpus.conversion,
            app: { ...corpus.conversion.app, [found.path]: found.file },
          },
        };
        expect(run(broken, 5)?.status).toBe('fail');
      });
    },
  );
});
