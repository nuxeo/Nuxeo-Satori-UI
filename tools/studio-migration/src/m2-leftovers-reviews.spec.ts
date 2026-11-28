/**
 * What the two independent reviews of M2's leftovers found, one of correctness and one adversarial,
 * on the made-up package with M2's corpus and its leftovers (`testing/m2-leftovers-corpus.ts`). Each
 * case below converted wrongly, or failed a faithful conversion, before its fix.
 */
import { loadCatalogue } from './catalogue';
import { convert, type Conversion, type ReportEntry } from './convert';
import { runCheck, type HarnessInput } from './harness';
import { inventory } from './inventory';
import { readStudioPackage } from './studio-package';
import { m2AllFiles } from './testing/m2-leftovers-corpus';
import { syntheticPackage } from './testing/synthetic-package';

const UI = 'web/nuxeo.war/ui';
const catalogue = loadCatalogue();
const ALLOW_LIST: ReadonlySet<string> = new Set(['Claim.Approve']);

const VEHICLES = `${UI}/nuxeo-Acme-Claims-vehicles-bundle.html`;
const RESULTS = `${UI}/search/vehicles/nuxeo-vehicles-search-results.html`;
const HOME = `${UI}/nuxeo-home.html`;
const RECENT = `dashboard-card:${HOME}#4`;
const FILES = m2AllFiles();

function prepare(bundle: Record<string, string> = FILES): HarnessInput {
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

/** The made-up package with one file of the leftovers corpus changed. */
const changed = (path: string, change: (text: string) => string): HarnessInput =>
  prepare({ ...FILES, [path]: change(FILES[path]) });

const run = (input: HarnessInput, number: number) => runCheck(input, number);

const entry = (conversion: Conversion, id: string): ReportEntry | undefined =>
  conversion.report.constructs.find((candidate) => candidate.id === id);

// The tests reach into a file as the JSON it is; typing each shape would only restate it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function edit(input: HarnessInput, path: string, change: (file: any) => unknown): HarnessInput {
  const file = JSON.parse(JSON.stringify(input.conversion.app[path] ?? null));
  const app: Record<string, unknown> = { ...input.conversion.app, [path]: change(file) };
  return { ...input, conversion: { ...input.conversion, app } };
}

/** The tab of Vehicle's view file with the given id. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const vehicleTab = (conversion: Conversion, id: string): any =>
  (conversion.app['layouts/Vehicle/view.layout.json'] as { tabs?: { id: string }[] }).tabs?.find(
    (tab) => tab.id === id,
  );

const inGroup = (group: string) => ({ type: 'app.rules.inGroup', parameters: [group] });

describe('what the reviews of M2’s leftovers found', () => {
  const corpus = prepare();

  it("reports a search screen of two tables in different conditions, rather than taking the first's", () => {
    const input = changed(RESULTS, (text) =>
      text.replace(
        '<nuxeo-filter user="[[user]]" group="fleet">',
        '<nuxeo-results name="summary"><nuxeo-data-table><nuxeo-data-table-column name="Plate" field="ve:plate"></nuxeo-data-table-column></nuxeo-data-table></nuxeo-results>\n    <nuxeo-filter user="[[user]]" group="fleet">',
      ),
    );
    expect(input.conversion.app['queues/vehicles.json']).toBeUndefined();
    expect(entry(input.conversion, `search:${RESULTS}#search`)).toMatchObject({
      outcome: 'reported',
      note: expect.stringMatching(/show 2 tables, not all of them in the same condition/),
    });
    const written = edit(input, 'queues/vehicles.json', () => ({
      version: 2,
      label: 'vehicles',
      pageProvider: 'vehicles',
      columns: ['ve:plate', 've:make'],
    }));
    expect(run(written, 5)?.findings).toEqual([
      'queues/vehicles.json: it lists vehicles for everyone, though Web UI shows the table only while a condition passes',
    ]);
  });

  it("reports a card showing the person's tasks and a list, and reads a condition inside a tasks or recent card", () => {
    const mixed = changed(HOME, (text) =>
      text.replace(
        '<nuxeo-card heading="My tasks"><nuxeo-tasks-list></nuxeo-tasks-list></nuxeo-card>',
        '<nuxeo-card heading="My tasks"><nuxeo-page-provider id="v" provider="vehicles"></nuxeo-page-provider><nuxeo-data-table nx-provider="v"><nuxeo-data-table-column name="Plate"><template>[[item.properties.ve:plate]]</template></nuxeo-data-table-column></nuxeo-data-table><nuxeo-filter user="[[user]]" group="supervisors"><template><nuxeo-tasks-list></nuxeo-tasks-list></template></nuxeo-filter></nuxeo-card>',
      ),
    );
    expect(entry(mixed.conversion, `dashboard-card:${HOME}#3`)).toMatchObject({
      outcome: 'reported',
      note: expect.stringMatching(/a list of a page provider and the person's tasks/),
    });
    expect(JSON.stringify(mixed.conversion.app['home.json'])).not.toContain('"card-3"');
    // Its condition guards a card that is reported: reported with it, never said to guard nothing.
    expect(entry(mixed.conversion, `condition:${HOME}#1`)).toMatchObject({
      outcome: 'reported',
      note: expect.stringMatching(/nothing it guards carries it, and nothing will/),
    });
    const inner = changed(HOME, (text) =>
      text
        .replace(
          '<nuxeo-card heading="My tasks"><nuxeo-tasks-list></nuxeo-tasks-list></nuxeo-card>',
          '<nuxeo-card heading="My tasks"><nuxeo-filter user="[[user]]" group="supervisors"><template><nuxeo-tasks-list></nuxeo-tasks-list></template></nuxeo-filter></nuxeo-card>',
        )
        .replace(
          '<nuxeo-document-storage name="nuxeo-recent-documents" documents="{{recentDocuments}}"></nuxeo-document-storage>',
          '<nuxeo-filter user="[[user]]" group="viewers"><template><nuxeo-document-storage name="nuxeo-recent-documents" documents="{{recentDocuments}}"></nuxeo-document-storage></template></nuxeo-filter>',
        ),
    );
    expect(
      (inner.conversion.app['home.json'] as { cards: Record<string, unknown>[] }).cards[1],
    ).toEqual({ id: 'card-3', label: 'My tasks', tasks: {}, visibleWhen: inGroup('supervisors') });
    expect(entry(inner.conversion, RECENT)?.proposes).toEqual({
      id: 'card-4',
      label: 'Recently viewed',
      recent: {},
      visibleWhen: inGroup('viewers'),
    });
    for (const number of [5, 7]) expect(run(inner, number)?.findings).toEqual([]);
  });

  it('reports the condition of a recently viewed card a person rejected, rather than leaving it pending', () => {
    const input = changed(HOME, (text) =>
      text.replace(
        '<nuxeo-document-storage name="nuxeo-recent-documents" documents="{{recentDocuments}}"></nuxeo-document-storage>',
        '<nuxeo-filter user="[[user]]" group="viewers"><template><nuxeo-document-storage name="nuxeo-recent-documents" documents="{{recentDocuments}}"></nuxeo-document-storage></template></nuxeo-filter>',
      ),
    );
    const condition = `condition:${HOME}#1`;
    expect(entry(input.conversion, condition)).toMatchObject({ outcome: 'pending' });
    const rejected = convert(input.pkg, input.inventory, catalogue, {
      allowList: ALLOW_LIST,
      verdicts: new Map([[RECENT, { accepted: false, owner: 'Dana', reason: 'Not wanted' }]]),
    });
    expect(entry(rejected, RECENT)).toMatchObject({ applied: 'reject' });
    expect(entry(rejected, condition)).toMatchObject({
      outcome: 'reported',
      note: expect.stringMatching(/or a proposal a person decided/),
    });
    const accepted = convert(input.pkg, input.inventory, catalogue, {
      allowList: ALLOW_LIST,
      verdicts: new Map([[RECENT, { accepted: true, owner: 'Dana', reason: 'Will do' }]]),
    });
    expect(entry(accepted, condition)).toMatchObject({
      outcome: 'converted',
      to: 'the visibleWhen of home.json card-4',
    });
  });

  it('holds two columns of one property under different conditions each to its own', () => {
    const input = changed(RESULTS, (text) =>
      text.replace(
        '<nuxeo-data-table-column name="Notes" field="ve:notes">',
        '<nuxeo-data-table-column name="Mileage too" field="ve:mileage"><template><nuxeo-filter user="[[user]]" group="managers"><template>[[item.properties.ve:mileage]]</template></nuxeo-filter></template></nuxeo-data-table-column><nuxeo-data-table-column name="Notes" field="ve:notes">',
      ),
    );
    const queue = input.conversion.app['queues/vehicles.json'] as {
      columns: Record<string, unknown>[];
    };
    expect(queue.columns.map((column) => column['label'])).toEqual([
      'Plate',
      'Make',
      'Mileage',
      'Mileage too',
    ]);
    for (const number of [2, 5, 6]) expect(run(input, number)?.findings).toEqual([]);
    const swapped = edit(input, 'queues/vehicles.json', (file) => {
      [file.columns[2].visibleWhen, file.columns[3].visibleWhen] = [
        file.columns[3].visibleWhen,
        file.columns[2].visibleWhen,
      ];
      return file;
    });
    expect(run(swapped, 5)?.findings).toHaveLength(2);
    const bare = edit(input, 'queues/vehicles.json', (file) => {
      delete file.columns[3].visibleWhen;
      return file;
    });
    expect(run(bare, 5)?.findings).toEqual([
      'queues/vehicles.json: it shows the column ve:mileage to everyone, though Web UI shows it only while a condition passes',
    ]);
    const renamed = edit(input, 'queues/vehicles.json', (file) => {
      file.columns[3].label = 'Mileage';
      return file;
    });
    expect(run(renamed, 6)?.findings).toEqual([
      'queues/vehicles.json: the column ve:mileage: the app shows "Mileage", where Web UI shows "Mileage too"',
    ]);
  });

  it('fails a list offering actions, a new record or a search that Web UI does not', () => {
    const offering = edit(corpus, 'layouts/Vehicle/view.layout.json', (file) => {
      const related = file.tabs[1].cards[0].related;
      related.rowActions = ['app.rowActions.delete'];
      related.create = { type: 'Claim', field: 'cl:number' };
      return file;
    });
    expect(run(offering, 7)?.findings).toEqual([
      'layouts/Vehicle/view.layout.json tab claims: it offers actions on its rows, ["app.rowActions.delete"], which Web UI\'s tab claims does not',
      "layouts/Vehicle/view.layout.json tab claims: it offers to create a record, which Web UI's tab claims does not",
    ]);
    const queue = edit(corpus, 'queues/vehicles.json', (file) => ({
      ...file,
      bulkActions: ['app.bulkActions.downloadZip'],
      search: { label: 'Plate' },
    }));
    expect(run(queue, 7)?.findings).toEqual([
      'queues/vehicles.json: it offers actions on a selection, ["app.bulkActions.downloadZip"], which Web UI\'s list does not',
      "queues/vehicles.json: it waits for a search before it lists anything, where Web UI's list does not",
    ]);
  });

  it('lets a listing whose column waits only on a proposed condition follow the proposal', () => {
    const input = changed(VEHICLES, (text) =>
      text.replace(
        '<template><nuxeo-filter user="[[user]]" group="adjusters"><template>[[item.properties.cl:reserve]]</template></nuxeo-filter></template>',
        '<template><template is="dom-if" if="[[hasFacet(document, \'Versionable\')]]">[[item.properties.cl:reserve]]</template></template>',
      ),
    );
    for (const index of [1, 2]) {
      const tab = entry(input.conversion, `slot-contribution:${VEHICLES}#${index}`);
      expect(tab).toMatchObject({
        outcome: 'proposed',
        to: 'layouts/Vehicle/view.layout.json tabs.claims',
        note: expect.stringMatching(
          /its column 4, cl:reserve, is left out: .*whose rule is proposed/,
        ),
      });
      // It follows the condition's proposal, and takes no decision of its own.
      expect(tab).not.toHaveProperty('proposal');
    }
  });

  it('lets a dashboard card whose column waits only on a proposed condition follow the proposal', () => {
    const input = changed(HOME, (text) =>
      text
        .replace(
          '<template><nuxeo-filter user="[[user]]" group="inspectors"><template>[[item.properties.ve:mileage]]</template></nuxeo-filter></template>',
          '<template><template is="dom-if" if="[[isMember(user, \'inspectors\')]]">[[item.properties.ve:mileage]]</template></template>',
        )
        .replace(/<nuxeo-data-table-column name="Notes">.*?<\/nuxeo-data-table-column>/, ''),
    );
    const card = entry(input.conversion, `dashboard-card:${HOME}#5`);
    expect(card).toMatchObject({
      outcome: 'proposed',
      to: 'home.json card-5, its list in queues/home-5-vehicles.json',
      note: expect.stringMatching(
        /its column 2, ve:mileage, is left out: .*whose rule is proposed/,
      ),
    });
    expect(card).not.toHaveProperty('proposal');
  });

  it('reports a listing that sends a property of the open record that a type it shows on has not', () => {
    const input = changed(VEHICLES, (text) =>
      text
        .replace(
          '"queryParams": "[[document.uid]]"}\' sort=',
          '"queryParams": "[[document.properties.ve:plate]]"}\' sort=',
        )
        .replaceAll(
          'type="Vehicle">\n      <template>\n        <div name="claims">',
          'type="Vehicle, Claim">\n      <template>\n        <div name="claims">',
        )
        .replace(
          'type="Vehicle">\n      <template><nuxeo-page-item name="claims"',
          'type="Vehicle, Claim">\n      <template><nuxeo-page-item name="claims"',
        ),
    );
    expect(vehicleTab(input.conversion, 'claims')).toBeUndefined();
    expect(entry(input.conversion, `slot-contribution:${VEHICLES}#1`)).toMatchObject({
      outcome: 'reported',
      note: expect.stringMatching(/sends the open record's ve:plate, which Claim has not/),
    });
  });

  it('reads a listing in a card or a native element, reports one in an element of its own, and takes a table naming its provider by $', () => {
    const page = (root: string, close: string) =>
      FILES[VEHICLES].replace('<div name="claims">', root).replace(
        '</nuxeo-data-table>\n        </div>',
        `</nuxeo-data-table>\n        ${close}`,
      );
    const card = prepare({
      ...FILES,
      [VEHICLES]: page('<nuxeo-card name="claims">', '</nuxeo-card>').replace(
        'nx-provider="claimsProvider"',
        'nx-provider="[[$.claimsProvider]]"',
      ),
    });
    expect(vehicleTab(card.conversion, 'claims').cards[0].related.pageProvider).toBe(
      'vehicle_claims',
    );
    const own = prepare({
      ...FILES,
      [VEHICLES]: page('<acme-claims-list name="claims">', '</acme-claims-list>'),
    });
    expect(vehicleTab(own.conversion, 'claims')).toBeUndefined();
    expect(entry(own.conversion, `slot-contribution:${VEHICLES}#2`)).toMatchObject({
      outcome: 'reported',
      note: expect.stringMatching(/^Its page is acme-claims-list, an element of its own/),
    });
  });
});
