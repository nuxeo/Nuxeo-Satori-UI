import { loadCatalogue } from './catalogue';
import { versionOne } from './check-package';
import { readable } from './check-seen';
import { convert, type Conversion } from './convert';
import { runCheck, runHarness, type HarnessInput } from './harness';
import { MUTATIONS, ruleHolders } from './mutations';
import { inventory } from './inventory';
import { readStudioPackage } from './studio-package';
import {
  syntheticBundleFiles,
  syntheticPackage,
  type SyntheticPackageOptions,
} from './testing/synthetic-package';

const UI = 'web/nuxeo.war/ui';
const catalogue = loadCatalogue();

function prepare(options?: SyntheticPackageOptions): HarnessInput {
  const pkg = readStudioPackage(syntheticPackage(options));
  const read = inventory(pkg);
  const allowList = new Set(['Claim.Approve']);
  return {
    pkg,
    inventory: read,
    catalogue,
    allowList,
    platformVersion: '0.2.0',
    conversion: convert(pkg, read, catalogue, { allowList, platformVersion: '0.2.0' }),
  };
}

/** What one check finds: that check alone, as the harness runs it, not the ten. */
const run = (input: HarnessInput, number: number) => runCheck(input, number);

/** The input with one file of the converted app definition replaced, or removed. */
// The tests reach into a file as the JSON it is; typing each shape would only restate it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function edit(input: HarnessInput, path: string, change: (file: any) => unknown): HarnessInput {
  const file = JSON.parse(JSON.stringify(input.conversion.app[path] ?? null));
  const changed = change(file);
  const app: Record<string, unknown> = { ...input.conversion.app };
  if (changed === undefined) delete app[path];
  else app[path] = changed;
  const conversion: Conversion = { ...input.conversion, app };
  return { ...input, conversion };
}

describe('check 2, fields', () => {
  const input = prepare();

  it('fails on a field Web UI does not show, and on a layout file no Web UI layout gives', () => {
    const extra = edit(input, 'layouts/Claim/edit.layout.json', (file) => {
      file.cards[0].fields.push('cl:amount');
      return file;
    });
    expect(run(extra, 2)?.findings).toEqual([
      "layouts/Claim/edit.layout.json: it shows cl:amount, which Web UI's edit layout of Claim does not",
    ]);
    const invented = edit(input, 'layouts/Party/view.layout.json', () => ({
      version: 2,
      cards: [{ id: 'x', fields: ['pt:name'] }],
    }));
    expect(run(invented, 2)?.findings).toEqual([
      'layouts/Party/view.layout.json: the package has no Web UI layout of that type and mode',
    ]);
  });

  it('fails on a version 1 file that names a widget, which version 1 ignores', () => {
    const named = edit(input, 'layouts/Claim/metadata.layout.json', (file) => {
      file.sections[0].fields[0] = { field: 'cl:number', label: 'Claim number', widget: 'text' };
      return file;
    });
    expect(run(named, 2)?.findings).toContain(
      'layouts/Claim/metadata.layout.json: sections.0.fields.0 names a widget, which version 1 cannot do and ignores',
    );
  });

  it('fails on a file of the wrong version for its mode', () => {
    // The app draws the edit and create forms of version 2, and reads metadata in version 1 alone.
    const v1 = edit(input, 'layouts/Claim/edit.layout.json', (file) => ({ ...file, version: 1 }));
    expect(run(v1, 2)?.findings).toContain(
      'layouts/Claim/edit.layout.json: it is not version 2, which the app reads in edit mode',
    );
    const v2 = edit(input, 'layouts/Claim/metadata.layout.json', (file) => ({
      ...file,
      version: 2,
    }));
    expect(run(v2, 2)?.findings).toContain(
      'layouts/Claim/metadata.layout.json: it is not version 1, which the app reads in metadata mode',
    );
  });

  it("fails on a list's columns out of order, missing or shown with another widget", () => {
    const swapped = edit(input, 'queues/claims.json', (file) => ({
      ...file,
      columns: [...file.columns].reverse(),
    }));
    expect(run(swapped, 2)?.findings).toEqual([
      'queues/claims.json: its columns are in the order cl:amount, dc:title, not dc:title, cl:amount',
    ]);
    const relative = edit(input, 'queues/home-1-claims.json', (file) => {
      file.columns[1].widget = 'date';
      file.columns.pop();
      return file;
    });
    expect(run(relative, 2)?.findings).toEqual([
      'queues/home-1-claims.json: the column cl:incidentDate is missing',
    ]);
  });

  it('fails on a vocabulary widget with another directory', () => {
    const path = `${UI}/document/claim/nuxeo-claim-view-layout.html`;
    const vocabulary = prepare({
      bundle: {
        [path]: syntheticBundleFiles()[path].replace(
          '</template>\n  <script>',
          '<nuxeo-directory-suggestion role="widget" value="[[document.properties.cl:adjuster]]" directory-name="adjusters"></nuxeo-directory-suggestion></template>\n  <script>',
        ),
      },
    });
    expect(run(vocabulary, 2)?.findings).toEqual([]);
    const other = edit(vocabulary, 'layouts/Claim/view.layout.json', (file) => {
      file.cards[0].fields[4].parameters.directory = 'others';
      return file;
    });
    expect(run(other, 2)?.findings).toEqual([
      'layouts/Claim/view.layout.json: cl:adjuster\'s vocabulary widget has the parameters {"directory":"others"}, not {"directory":"adjusters"}',
    ]);
  });

  it('accepts a field the report reports, with its reason, as accounted for', () => {
    const dropped = edit(input, 'layouts/Claim/metadata.layout.json', (file) => {
      expect(file.sections[0].fields.at(-1)).toEqual({ field: 'cl:adjuster', label: 'Adjuster' });
      file.sections[0].fields.pop();
      return file;
    });
    // cl:adjuster is reported: version 1 cannot show it as a user.
    expect(run(dropped, 2)?.findings).toEqual([]);
  });
});

describe('check 3, model', () => {
  const input = prepare();

  it("fails on a widget that does not show its property's type", () => {
    const wrong = edit(input, 'layouts/Claim/view.layout.json', (file) => {
      file.cards[0].fields[1] = { field: 'cl:amount', widget: 'date' };
      return file;
    });
    expect(run(wrong, 3)?.findings).toEqual([
      'layouts/Claim/view.layout.json cards.0.fields.1: the date widget does not show cl:amount, which is a double',
    ]);
  });

  it('fails on a property of a schema the type does not have', () => {
    const party = edit(input, 'layouts/Claim/view.layout.json', (file) => {
      file.cards[0].fields.push('pt:name');
      return file;
    });
    expect(run(party, 3)?.findings).toEqual([
      'layouts/Claim/view.layout.json cards.0.fields.4: the schema party has no field name, so pt:name does not exist',
    ]);
    const typed = prepare({
      bundle: {
        'data/schemas/party.xsd':
          '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="name" type="xs:string"/></xs:schema>',
      },
    });
    const elsewhere = edit(typed, 'layouts/Claim/view.layout.json', (file) => {
      file.cards[0].fields.push('pt:name');
      return file;
    });
    expect(run(elsewhere, 3)?.findings).toEqual([
      'layouts/Claim/view.layout.json cards.0.fields.4: the type Claim has no party schema, so it has no pt:name',
    ]);
  });

  it('lists what rests on the platform, and passes only when nothing does', () => {
    expect(run(input, 3)).toMatchObject({ status: 'partial', findings: [] });
    const own = edit(
      edit(input, 'queues/claims.json', (file) => ({ ...file, columns: file.columns.slice(1) })),
      'queues/home-1-claims.json',
      (file) => ({ ...file, columns: file.columns.slice(1) }),
    );
    expect(run(own, 3)).toMatchObject({ status: 'pass', findings: [] });
  });

  it('fails when a schema it needs cannot be read', () => {
    const unreadable = prepare({ bundle: { 'data/schemas/claim.xsd': '<xs:schema' } });
    expect(run(unreadable, 3)?.findings).toContain(
      "layouts/Claim/view.layout.json cards.0.fields.0: cl:number cannot be checked, because the schema claim's file cannot be read",
    );
  });
});

describe('check 5, conditions', () => {
  it('passes a package with no condition and no rule, and runs in part with conditions to come', () => {
    const files = syntheticBundleFiles();
    const results = `${UI}/search/claims/nuxeo-claims-search-results.html`;
    const none = prepare({
      without: [`${UI}/document/claim/nuxeo-claim-metadata-layout.html`],
      bundle: {
        [`${UI}/document/claim/nuxeo-claim-view-layout.html`]: files[
          `${UI}/document/claim/nuxeo-claim-view-layout.html`
        ]
          .replace(/<nuxeo-filter[\s\S]*?<\/nuxeo-filter>/, '')
          .replace(/<template is="dom-if"[\s\S]*?<\/template>/, ''),
        [results]: files[results].replace(
          /<nuxeo-data-table-column name="Reserve"[\s\S]*?<\/nuxeo-data-table-column>/,
          '',
        ),
        [`${UI}/nuxeo-Acme-Claims-bundle.html`]: files[
          `${UI}/nuxeo-Acme-Claims-bundle.html`
        ].replace(/<nuxeo-slot-content name="closeClaim"[\s\S]*?<\/nuxeo-slot-content>/, ''),
      },
    });
    expect(run(none, 5)).toMatchObject({ status: 'pass', findings: [] });
    expect(run(prepare(), 5)).toMatchObject({ status: 'partial', findings: [] });
  });

  it('fails on a rule anywhere in the package, a queue or an action included', () => {
    const input = prepare();
    const queue = edit(input, 'queues/claims.json', (file) => ({
      ...file,
      visibleWhen: 'app.rules.canWrite',
    }));
    expect(run(queue, 5)?.findings).toEqual([
      'queues/claims.json: visibleWhen holds a rule that no condition of the package gives',
    ]);
    const required = edit(input, 'layouts/Claim/edit.layout.json', (file) => {
      file.cards[0].fields[0].required = 'app.rules.canWrite';
      return file;
    });
    expect(run(required, 5)?.findings).toHaveLength(1);
  });

  it('fails on a button Web UI shows only under a condition, made an action for everyone', () => {
    const input = prepare();
    const widened = edit(input, 'actions.json', (file) => {
      file.actions.push({ id: 'acme-claims.closeClaim', label: 'Close', operation: 'Claim.Close' });
      return file;
    });
    expect(run(widened, 5)?.findings).toEqual([
      'actions.json: acme-claims.closeClaim shows to everyone, though Web UI shows "closeClaim" only while a condition passes',
    ]);
  });
});

describe('check 6, what people see', () => {
  const input = prepare();

  it('works a label out as the app does: the label, the key, the field key, the name', () => {
    expect(readable('billedAmount')).toBe('Billed amount');
    expect(readable('memberID')).toBe('Member ID');
    const keyed = edit(input, 'layouts/Claim/view.layout.json', (file) => {
      file.cards[0].fields[0] = { field: 'cl:number', labelKey: 'label.claim.number' };
      file.cards[0].fields[1] = 'cl:amount';
      return file;
    });
    // "Claim number" from the package's labels; "Amount", the name made readable.
    expect(run(keyed, 6)?.findings).toEqual([]);
    const wrongKey = edit(input, 'layouts/Claim/view.layout.json', (file) => {
      file.cards[0].fields[0] = { field: 'cl:number', labelKey: 'label.claim.amount' };
      return file;
    });
    expect(run(wrongKey, 6)?.findings).toEqual([
      'layouts/Claim/view.layout.json: cl:number: the app shows "Amount", where Web UI shows "Claim number"',
    ]);
  });

  it("compares a list's name with its menu entry, and its columns with Web UI's headings", () => {
    const renamed = edit(input, 'queues/claims.json', (file) => ({ ...file, label: 'All claims' }));
    expect(run(renamed, 6)?.findings).toEqual([
      'queues/claims.json: its name: the app shows "All claims", where Web UI shows "Claims"',
    ]);
  });

  it('lists a label that rests on a catalogue not in hand, and never passes whole', () => {
    expect(run(input, 6)).toMatchObject({ status: 'partial', findings: [] });
    const path = `${UI}/document/claim/nuxeo-claim-view-layout.html`;
    const webKey = prepare({
      bundle: {
        [path]: syntheticBundleFiles()[path].replace(
          '<label>Amount</label>',
          "<label>[[i18n('claim.amount.heading')]]</label>",
        ),
      },
    });
    expect(run(webKey, 6)?.reason).toMatch(
      /1 label rests on a catalogue or a binding the package does not hold: claim\.amount\.heading \(Web UI's and the app's\)/,
    );
  });
});

describe('check 7, what the server is asked', () => {
  const input = prepare();

  it('fails on a list asking with other parameters, sort or page size', () => {
    const sorted = edit(input, 'queues/claims.json', (file) => ({ ...file, sort: [] }));
    expect(run(sorted, 7)?.findings).toEqual([
      'queues/claims.json: it sorts by [], where Web UI opens sorted by [{"field":"cl:amount","order":"desc"}]',
    ]);
    const paged = edit(input, 'queues/home-1-claims.json', (file) => ({ ...file, pageSize: 50 }));
    expect(run(paged, 7)?.findings).toEqual([
      'queues/home-1-claims.json: it asks for pages of 50, where Web UI asks for 20',
    ]);
  });

  it("fails on a list that sends other parameters than Web UI's card", () => {
    const changed = edit(input, 'queues/home-1-claims.json', (file) => ({
      ...file,
      parameters: ['closed'],
    }));
    expect(run(changed, 7)?.findings).toEqual([
      'queues/home-1-claims.json: it sends the parameters ["closed"], where Web UI sends ["open"]',
    ]);
    const search = edit(input, 'queues/claims.json', (file) => ({ ...file, parameters: ['x'] }));
    expect(run(search, 7)?.findings).toEqual([
      'queues/claims.json: it sends the parameters ["x"], where Web UI sends []',
    ]);
  });

  it('fails on a list or an action the package does not have', () => {
    const queue = edit(input, 'queues/extra.json', () => ({
      version: 2,
      label: 'x',
      pageProvider: 'claims',
    }));
    expect(run(queue, 7)?.findings).toEqual([
      'queues/extra.json: it asks for a list that no screen or card of the package asks for',
    ]);
    const action = edit(input, 'actions.json', (file) => {
      file.actions.push({ id: 'acme-claims.purge', label: 'Purge', operation: 'Document.Delete' });
      return file;
    });
    expect(run(action, 7)?.findings).toEqual([
      'actions.json: "acme-claims.purge" runs something no button of the package runs',
    ]);
  });

  it('fails when an allowed button has no action', () => {
    const missing = edit(input, 'actions.json', () => undefined);
    expect(run(missing, 7)?.findings).toEqual([
      'actions.json: acme-claims.approveClaim is missing, though Web UI\'s "approveClaim" runs Claim.Approve',
    ]);
  });

  it('fails on an action that runs on a selection where Web UI runs it on the record', () => {
    const bulk = edit(input, 'actions.json', (file) => {
      file.actions[0].on = ['bulk'];
      return file;
    });
    expect(run(bulk, 7)?.findings).toEqual([
      "actions.json: acme-claims.approveClaim runs on a selection, where Web UI's runs on the open record",
    ]);
  });
});

describe('check 10, package', () => {
  const input = prepare();

  it("holds every file to the package pipeline's validator", () => {
    expect(run(input, 10)).toMatchObject({ status: 'pass', findings: [] });
    const refused = { ...input, allowList: new Set<string>() };
    expect(run(refused, 10)?.findings).toEqual([
      expect.stringMatching(/^app\/actions\.json actions\[0\]\.operation: .*Claim\.Approve/),
    ]);
    const range = { ...input, platformVersion: '2.0.0' };
    expect(run(range, 10)?.findings).toEqual([expect.stringMatching(/^app\/app\.json platform: /)]);
  });

  it('refuses a file out of place, a file that is not JSON outside assets/, and a missing app.json', () => {
    const misplaced = edit(input, 'queue/open.json', () => ({ version: 2 }));
    expect(run(misplaced, 10)?.findings).toEqual([
      'app/queue/open.json: it is out of place, so the package would be refused',
    ]);
    const asset = {
      ...input,
      conversion: { ...input.conversion, appAssets: { 'logo.png': Buffer.from('x') } },
    };
    expect(run(asset, 10)?.findings).toEqual([
      'app/logo.png: a file that is not JSON belongs in assets/',
    ]);
    const noApp = edit(input, 'app.json', () => undefined);
    expect(run(noApp, 10)?.findings).toContain(
      'app/app.json is missing: an app definition needs one',
    );
  });

  it("holds a version 1 layout to version 1's contract", () => {
    expect(versionOne({ version: 1, sections: [] })).toEqual([]);
    expect(
      versionOne({
        version: 1,
        display: 'columns',
        sections: [
          {
            id: 'a',
            fields: [
              'cl:number',
              'cl:number',
              'number',
              { field: 'cl:x', widget: 'text', required: 'yes' },
            ],
          },
          { id: 'a', fields: [] },
          { id: '-b' },
        ],
      }),
    ).toEqual([
      'display is "sections" or "tabs"',
      'sections.0.fields.1 lists cl:number again in its section',
      'sections.0.fields.2 is not "<prefix>:<name>" or { "field": "<prefix>:<name>" }',
      'sections.0.fields.3.widget is not a key version 1 has, and the app ignores it',
      'sections.0.fields.3.required is true, or left out',
      'sections.1.id "a" is used twice',
      'sections.2.id is 1 to 64 letters, digits, ".", "_" or "-", starting with a letter or digit',
      'sections.2.fields must be a list',
    ]);
  });
});

// Found by the independent review of this change: each was a way to drop, widen or misread
// something that every check still passed.
describe('what the review found', () => {
  const view = `${UI}/document/claim/nuxeo-claim-view-layout.html`;
  const edit2 = `${UI}/document/claim/nuxeo-claim-edit-layout.html`;
  const layoutFile = (name: string, body: string, type = 'Claim'): string =>
    `<dom-module id="${name}"><template>${body}</template><script>
    Polymer({ is: '${name}', behaviors: [Nuxeo.LayoutBehavior],
      properties: { /** @doctype ${type} */ document: { type: Object } } });
  </script></dom-module>`;

  it('shows a property Web UI shows to everyone, though an earlier field binds it under a condition', () => {
    const input = prepare({
      bundle: {
        [view]: layoutFile(
          'nuxeo-claim-view-layout',
          `<nuxeo-filter group="adjusters"><template><div role="widget"><label>Reserve</label><div>[[document.properties.cl:reserve]]</div></div></template></nuxeo-filter>
           <div role="widget"><label>Reserve</label><div>[[document.properties.cl:reserve]]</div></div>`,
        ),
      },
    });
    expect(input.conversion.app['layouts/Claim/view.layout.json']).toEqual({
      version: 2,
      cards: [{ id: 'fields', fields: [{ field: 'cl:reserve', label: 'Reserve' }] }],
    });
    expect(run(input, 2)?.findings).toEqual([]);
    expect(run(input, 5)?.findings).toEqual([]);
    const dropped = edit(input, 'layouts/Claim/view.layout.json', () => undefined);
    expect(run(dropped, 2)?.findings).toEqual([
      "layouts/Claim/view.layout.json: cl:reserve is missing, though Web UI's view layout of Claim shows it",
    ]);
  });

  it('shows a property through the first field the catalogue knows, with its required flag', () => {
    const input = prepare({
      bundle: {
        [edit2]: layoutFile(
          'nuxeo-claim-edit-layout',
          `<acme-fancy-input role="widget" value="{{document.properties.cl:number}}"></acme-fancy-input>
           <nuxeo-input role="widget" value="{{document.properties.cl:number}}" label="Claim number" required></nuxeo-input>`,
        ),
      },
    });
    expect(input.conversion.app['layouts/Claim/edit.layout.json']).toEqual({
      version: 2,
      cards: [
        { id: 'fields', fields: [{ field: 'cl:number', label: 'Claim number', required: true }] },
      ],
    });
    expect(run(input, 2)?.findings).toEqual([]);
    expect(run(input, 6)?.findings).toEqual([]);
  });

  it('drops a field the report says was converted, so drop-field always breaks something check 2 holds', () => {
    // A field version 1 cannot show as Web UI does, written and reported, comes first in the first
    // layout: the metadata one, with no edit layout before it.
    const metadata = `${UI}/document/claim/nuxeo-claim-metadata-layout.html`;
    const input = prepare({
      without: [edit2],
      bundle: {
        [metadata]: layoutFile(
          'nuxeo-claim-metadata-layout',
          `<nuxeo-user-tag role="widget" user="[[document.properties.cl:adjuster]]" label="Adjuster"></nuxeo-user-tag>
           <div role="widget"><label>Claim number</label><div>[[document.properties.cl:number]]</div></div>`,
        ),
      },
    });
    const mutation = MUTATIONS.find((m) => m.name === 'drop-field');
    if (!mutation) throw new Error('drop-field is missing');
    const broken = mutation.apply(input.conversion);
    expect(broken.changed).toMatch(/^dropped cl:number /);
    expect(run({ ...input, conversion: broken.conversion }, 2)?.status).toBe('fail');
  });

  it('fails a queue written for a card Web UI shows only under a condition', () => {
    const home = `${UI}/nuxeo-home.html`;
    const input = prepare({
      bundle: {
        [home]: `<dom-module id="nuxeo-home"><template>
          <nuxeo-filter group="managers"><template>
            <nuxeo-card heading="Managers"><nuxeo-page-provider provider="claims"></nuxeo-page-provider></nuxeo-card>
          </template></nuxeo-filter>
        </template></dom-module>`,
      },
    });
    expect(input.conversion.app['queues/home-1-claims.json']).toBeUndefined();
    const widened = edit(input, 'queues/home-1-claims.json', () => ({
      version: 2,
      label: 'Managers',
      pageProvider: 'claims',
    }));
    expect(run(widened, 5)?.findings).toEqual([
      "queues/home-1-claims.json: it lists card 1's records for everyone, though Web UI shows the card only while a condition passes",
    ]);
    expect(run(widened, 7)?.findings).toEqual([
      'queues/home-1-claims.json: it asks for a list that no screen or card of the package asks for',
    ]);
  });

  it('finds the action an unnamed button under a condition would become', () => {
    const bundle = `${UI}/nuxeo-Acme-Claims-bundle.html`;
    const input = prepare({
      bundle: {
        [bundle]: syntheticBundleFiles()[bundle].replace(
          '<nuxeo-slot-content name="closeClaim"',
          '<nuxeo-slot-content name=""',
        ),
      },
    });
    const widened = edit(input, 'actions.json', (file) => {
      file.actions.push({ id: 'acme-claims.action-2', label: 'Close', operation: 'Claim.Close' });
      return file;
    });
    expect(run(widened, 5)?.findings).toEqual([
      'actions.json: acme-claims.action-2 shows to everyone, though Web UI shows "" only while a condition passes',
    ]);
  });

  it('reports a button whose parameter is bound to the page, rather than writing the binding', () => {
    const bundle = `${UI}/nuxeo-Acme-Claims-bundle.html`;
    const input = prepare({
      bundle: {
        [bundle]: syntheticBundleFiles()[bundle].replace(
          `params='{"comment": "Approved in Web UI"}'`,
          `params='{"target": "[[document.uid]]"}'`,
        ),
      },
    });
    expect(input.conversion.app['actions.json']).toBeUndefined();
    expect(
      input.conversion.report.constructs.find((entry) => entry.label.includes('approveClaim')),
    ).toMatchObject({ outcome: 'reported', note: expect.stringMatching(/bound to the page/) });
  });

  it('writes no label bound to the page as text, and check 6 lists it', () => {
    const input = prepare({
      bundle: {
        [view]: syntheticBundleFiles()[view].replace(
          'label="Incident date"',
          `label="[[i18n('label.claim.incident', 'Incident')]]"`,
        ),
      },
    });
    expect(input.conversion.app['layouts/Claim/view.layout.json']).toMatchObject({
      cards: [{ fields: [{}, {}, { field: 'cl:incidentDate', widget: 'date' }, {}] }],
    });
    expect(JSON.stringify(input.conversion.app['layouts/Claim/view.layout.json'])).not.toContain(
      '[[',
    );
    expect(run(input, 6)).toMatchObject({
      findings: [],
      reason: expect.stringMatching(
        /\[\[i18n\('label\.claim\.incident', 'Incident'\)\]\] \(Web UI's binding\)/,
      ),
    });
  });

  it("fails check 3 when a model contribution cannot be read, rather than calling its types the platform's", () => {
    const input = prepare({
      bundle: {
        'OSGI-INF/extensions.xml': syntheticBundleFiles()['OSGI-INF/extensions.xml'].replace(
          '</component>',
          '',
        ),
      },
    });
    expect(run(input, 3)?.findings).toContain(
      'the model: OSGI-INF/extensions.xml is not well-formed XML, so its part of the model is unknown',
    );
  });

  it("keeps a card's page size only when a queue takes it, and check 7 agrees", () => {
    const home = `${UI}/nuxeo-home.html`;
    for (const size of ['500', '0']) {
      const input = prepare({
        bundle: {
          [home]: syntheticBundleFiles()[home].replaceAll('page-size="20"', `page-size="${size}"`),
        },
      });
      expect(input.conversion.app['queues/home-1-claims.json']).not.toHaveProperty('pageSize');
      expect(run(input, 7)?.findings).toEqual([]);
    }
    const large = prepare({
      bundle: {
        [home]: syntheticBundleFiles()[home].replaceAll('page-size="20"', 'page-size="500"'),
      },
    });
    expect(
      large.conversion.report.constructs.find((entry) => entry.id === `dashboard-card:${home}#1`)
        ?.note,
    ).toMatch(/Its page size, 500, is not one a queue takes/);
  });

  it('holds only the first layout of a type and mode to its file, as the converter writes it', () => {
    const second = `${UI}/document/claim2/nuxeo-claim2-view-layout.html`;
    const input = prepare({
      bundle: {
        [second]: layoutFile(
          'nuxeo-claim2-view-layout',
          '<div role="widget"><label>Reserve</label><div>[[document.properties.cl:reserve]]</div></div>',
        ),
      },
    });
    expect(
      input.conversion.report.constructs.find((entry) => entry.id === `layout:${second}#layout`),
    ).toMatchObject({ outcome: 'reported', note: expect.stringMatching(/comes first/) });
    for (const number of [2, 5, 6]) expect(run(input, number)?.findings).toEqual([]);
  });

  it("does not take an action's literal parameter for a property", () => {
    const bundle = `${UI}/nuxeo-Acme-Claims-bundle.html`;
    const input = prepare({
      bundle: {
        [bundle]: syntheticBundleFiles()[bundle].replace(
          `params='{"comment": "Approved in Web UI"}'`,
          `params='{"comment": "Note: approved"}'`,
        ),
      },
    });
    expect(run(input, 3)?.reason).not.toContain('Note');
  });

  it("reports a card whose queue's name another list already has", () => {
    const form = `${UI}/search/claims/nuxeo-claims-search-form.html`;
    const results = `${UI}/search/claims/nuxeo-claims-search-results.html`;
    const files = syntheticBundleFiles();
    const input = prepare({
      without: [form, results],
      bundle: {
        [`${UI}/search/home-1-claims/nuxeo-home-1-claims-search-form.html`]: files[form],
        [`${UI}/search/home-1-claims/nuxeo-home-1-claims-search-results.html`]: files[results],
      },
    });
    expect(
      input.conversion.report.constructs.find(
        (entry) => entry.id === `dashboard-card:${UI}/nuxeo-home.html#1`,
      ),
    ).toMatchObject({
      outcome: 'reported',
      note: 'Another list is already written as queues/home-1-claims.json',
    });
    // The card has no queue of its own, so nothing holds it to the search screen's.
    for (const number of [2, 5, 6, 7]) expect(run(input, number)?.findings).toEqual([]);
  });

  it("gives two files' unnamed buttons actions of their own, and holds each to its own", () => {
    const button = (operation: string) =>
      `<nuxeo-slot-content name="" slot="DOCUMENT_ACTIONS"><template><nuxeo-operation-button operation="${operation}" label="${operation}" input="[[document]]"></nuxeo-operation-button></template></nuxeo-slot-content>`;
    const pkg = readStudioPackage(
      syntheticPackage({
        bundle: {
          [`${UI}/nuxeo-Acme-Claims-bundle.html`]: button('Claim.Approve'),
          [`${UI}/nuxeo-Acme-Extra-bundle.html`]: button('Claim.Reopen'),
        },
      }),
    );
    const read = inventory(pkg);
    const allowList = new Set(['Claim.Approve', 'Claim.Reopen']);
    const input: HarnessInput = {
      pkg,
      inventory: read,
      catalogue,
      allowList,
      platformVersion: '0.2.0',
      conversion: convert(pkg, read, catalogue, { allowList, platformVersion: '0.2.0' }),
    };
    const actions = input.conversion.app['actions.json'] as {
      actions: { id: string; operation: string }[];
    };
    expect(actions.actions.map((action) => [action.id, action.operation])).toEqual([
      ['acme-claims.action-1', 'Claim.Approve'],
      ['acme-claims.action-2', 'Claim.Reopen'],
    ]);
    for (const number of [5, 7, 10]) expect(run(input, number)?.findings).toEqual([]);
  });
});

// Found by Copilot's review of #643.
describe("what Copilot's review found", () => {
  const results = `${UI}/search/claims/nuxeo-claims-search-results.html`;
  const bundle = `${UI}/nuxeo-Acme-Claims-bundle.html`;

  it('reports a list column under a condition that does not convert, and fails one shown to everyone', () => {
    const input = prepare();
    expect(input.conversion.app['queues/claims.json']).toMatchObject({
      columns: [
        { field: 'dc:title', label: 'Title' },
        { field: 'cl:amount', label: 'Amount' },
      ],
    });
    expect(
      input.conversion.report.constructs.find((entry) => entry.id === `search-column:${results}#3`),
    ).toMatchObject({
      outcome: 'reported',
      note: expect.stringMatching(/^Condition 1 of its file does not convert: .*given no user/),
    });
    for (const number of [2, 5]) expect(run(input, number)?.findings).toEqual([]);
    const widened = edit(input, 'queues/claims.json', (file) => {
      file.columns.push({ field: 'cl:reserve', label: 'Reserve' });
      return file;
    });
    expect(run(widened, 5)?.findings).toEqual([
      'queues/claims.json: it shows the column cl:reserve to everyone, though Web UI shows it only while a condition passes',
    ]);
    expect(run(widened, 2)?.findings).toEqual([]);
  });

  it('reports a list whose table sits in a condition that does not convert, and fails one written for everyone', () => {
    const files = syntheticBundleFiles();
    const input = prepare({
      bundle: {
        [results]: files[results]
          .replace(
            '<nuxeo-data-table class="results">',
            '<nuxeo-filter group="adjusters"><template><nuxeo-data-table class="results">',
          )
          .replace('</nuxeo-data-table>', '</nuxeo-data-table></template></nuxeo-filter>'),
      },
    });
    expect(input.conversion.app['queues/claims.json']).toBeUndefined();
    expect(
      input.conversion.report.constructs.find((entry) => entry.id === `search:${results}#search`),
    ).toMatchObject({
      outcome: 'reported',
      note: expect.stringMatching(/^Condition \d+ of its file does not convert: .*given no user/),
    });
    expect(run(input, 2)?.findings).toEqual([]);
    const widened = edit(input, 'queues/claims.json', () => ({
      version: 2,
      label: 'Claims',
      pageProvider: 'claims',
    }));
    expect(run(widened, 5)?.findings).toEqual([
      'queues/claims.json: it lists claims for everyone, though Web UI shows the table only while a condition passes',
    ]);
  });

  it('takes a translation or a parameter named like a rule for what it is', () => {
    const input = prepare();
    const labels = edit(input, 'labels/en.json', (file) => {
      file.labels.required = 'Required';
      file.labels.visibleWhen = 'Shown when';
      return file;
    });
    expect(run(labels, 5)?.findings).toEqual([]);
    const parameters = edit(input, 'actions.json', (file) => {
      file.actions[0].parameters = { required: false, visibleWhen: 'always' };
      return file;
    });
    expect(run(parameters, 5)?.findings).toEqual([]);
    const optional = edit(input, 'layouts/Claim/edit.layout.json', (file) => {
      file.cards[0].fields[1] = { field: 'cl:incidentDate', widget: 'date', required: false };
      return file;
    });
    expect(run(optional, 5)?.findings).toEqual([]);
  });

  it("fails when a dashboard card's queue is missing, unless the card is reported", () => {
    const input = prepare();
    const missing = edit(input, 'queues/home-1-claims.json', () => undefined);
    expect(run(missing, 7)?.findings).toEqual([
      "queues/home-1-claims.json is missing, though Web UI's card 1 lists claims",
    ]);
  });

  it('holds an action to the button that owns its id, not to an earlier one that becomes none', () => {
    const button = (extra: string, operation: string) =>
      `<nuxeo-slot-content name="approveClaim" slot="DOCUMENT_ACTIONS"><template>${extra.replace('X', `<nuxeo-operation-button operation="${operation}" label="Approve" input="[[document]]"></nuxeo-operation-button>`)}</template></nuxeo-slot-content>`;
    for (const first of [
      button(
        '<nuxeo-filter permission="Write"><template>X</template></nuxeo-filter>',
        'Claim.Approve',
      ),
      button('X', 'Claim.Purge'),
    ]) {
      const input = prepare({ bundle: { [bundle]: first + button('X', 'Claim.Approve') } });
      expect(input.conversion.app['actions.json']).toMatchObject({
        actions: [{ id: 'acme-claims.approveClaim', operation: 'Claim.Approve' }],
      });
      for (const number of [5, 7]) expect(run(input, number)?.findings).toEqual([]);
    }
  });
});

// Found by Copilot's second review of #643.
describe("what Copilot's second review found", () => {
  const view = `${UI}/document/claim/nuxeo-claim-view-layout.html`;
  const results = `${UI}/search/claims/nuxeo-claims-search-results.html`;

  it('leaves a field out whose wrapper takes its binding from inside a condition that does not convert', () => {
    const files = syntheticBundleFiles();
    const input = prepare({
      bundle: {
        [view]: files[view].replace(
          '</template>\n  <script>',
          `<div role="widget"><label>Adjuster</label><nuxeo-filter group="adjusters"><template><nuxeo-input value="{{document.properties.cl:adjuster}}"></nuxeo-input></template></nuxeo-filter></div>
  </template>\n  <script>`,
        ),
      },
    });
    // The filter has no user, so it does not convert; the wrapper sits in none but holds it.
    expect(input.inventory.layouts[0].fields[5]).toMatchObject({
      binding: 'cl:adjuster',
      condition: 2,
    });
    expect(JSON.stringify(input.conversion.app['layouts/Claim/view.layout.json'])).not.toContain(
      'cl:adjuster',
    );
    const widened = edit(input, 'layouts/Claim/view.layout.json', (file) => {
      file.cards[0].fields.push('cl:adjuster');
      return file;
    });
    expect(run(widened, 5)?.findings).toEqual([
      'layouts/Claim/view.layout.json: it shows cl:adjuster to everyone, though Web UI shows it only while condition 3 passes',
    ]);
  });

  it('holds a property shown by a column in no condition to it, though another column shows it under one', () => {
    const input = prepare({
      bundle: {
        [results]: syntheticBundleFiles()[results].replace(
          '<nuxeo-data-table-column name="Amount" field="cl:amount"></nuxeo-data-table-column>',
          '<nuxeo-data-table-column name="Amount" field="cl:amount"></nuxeo-data-table-column><nuxeo-data-table-column name="Amount" field="cl:amount"><template><nuxeo-filter group="x"><template>[[item.properties.cl:amount]]</template></nuxeo-filter></template></nuxeo-data-table-column>',
        ),
      },
    });
    for (const number of [2, 5]) expect(run(input, number)?.findings).toEqual([]);
    const dropped = edit(input, 'queues/claims.json', (file) => ({
      ...file,
      columns: file.columns.filter((column: { field: string }) => column.field !== 'cl:amount'),
    }));
    expect(run(dropped, 2)?.findings).toEqual([
      'queues/claims.json: the column cl:amount is missing',
    ]);
  });

  it('writes no queue without a column, which the validator would refuse', () => {
    const home = `${UI}/nuxeo-home.html`;
    const input = prepare({
      bundle: {
        [results]: syntheticBundleFiles()[results].replace(
          /<nuxeo-data-table class="results">[\s\S]*<\/nuxeo-data-table>/,
          '<nuxeo-data-table class="results"><nuxeo-data-table-column name="Thumb"><template><nuxeo-document-thumbnail></nuxeo-document-thumbnail></template></nuxeo-data-table-column></nuxeo-data-table>',
        ),
        [home]: `<dom-module id="nuxeo-home"><template><nuxeo-card heading="Bare"><nuxeo-page-provider provider="claims"></nuxeo-page-provider></nuxeo-card></template></dom-module>`,
      },
    });
    expect(input.conversion.app['queues/claims.json']).toBeUndefined();
    expect(input.conversion.app['queues/home-1-claims.json']).toBeUndefined();
    const outcome = (id: string) =>
      input.conversion.report.constructs.find((entry) => entry.id === id);
    expect(outcome(`search:${results}#search`)).toMatchObject({
      outcome: 'reported',
      note: expect.stringMatching(/a queue needs at least one/),
    });
    expect(outcome(`dashboard-card:${home}#1`)).toMatchObject({
      outcome: 'reported',
      note: expect.stringMatching(/a queue needs at least one/),
    });
    for (const number of [2, 7, 10]) expect(run(input, number)?.findings).toEqual([]);
  });
});

// Found by Copilot's third review of #643.
describe("what Copilot's third review found", () => {
  const results = `${UI}/search/claims/nuxeo-claims-search-results.html`;
  const bundle = `${UI}/nuxeo-Acme-Claims-bundle.html`;
  const files = syntheticBundleFiles();

  it('gives a queue path to the first list that writes one, not to a search with no column', () => {
    // A search folder named as the dashboard card's queue, whose results show no property.
    const bare = files[results].replace(
      /<nuxeo-data-table class="results">[\s\S]*<\/nuxeo-data-table>/,
      '<nuxeo-data-table class="results"><nuxeo-data-table-column name="Thumb"></nuxeo-data-table-column></nuxeo-data-table>',
    );
    const input = prepare({
      bundle: {
        [`${UI}/search/home-1-claims/nuxeo-home-1-claims-search-form.html`]:
          files[`${UI}/search/claims/nuxeo-claims-search-form.html`],
        [`${UI}/search/home-1-claims/nuxeo-home-1-claims-search-results.html`]: bare,
      },
    });
    expect(
      input.inventory.searches.find(
        (search) => search.path.includes('home-1-claims/') && search.part === 'results',
      )?.provider,
    ).toBe('claims');
    expect(input.conversion.app['queues/home-1-claims.json']).toMatchObject({
      label: 'Open claims',
      parameters: ['open'],
    });
    for (const number of [2, 5, 6, 7]) expect(run(input, number)?.findings).toEqual([]);
    const deleted = edit(input, 'queues/home-1-claims.json', () => undefined);
    expect(run(deleted, 7)?.findings).toEqual([
      "queues/home-1-claims.json is missing, though Web UI's card 1 lists claims",
    ]);
  });

  it('holds a queue two search folders share to the first, and only to it', () => {
    const other = files[results].replace(
      '<nuxeo-data-table-column name="Amount" field="cl:amount"></nuxeo-data-table-column>',
      '',
    );
    const form = `${UI}/search/claims/nuxeo-claims-search-form.html`;
    const input = prepare({
      bundle: {
        [`${UI}/search/Claims/nuxeo-claims-search-form.html`]: files[form],
        [`${UI}/search/Claims/nuxeo-claims-search-results.html`]: other,
      },
    });
    const second = `search:${UI}/search/Claims/nuxeo-claims-search-results.html#search`;
    const first = `search:${UI}/search/claims/nuxeo-claims-search-results.html#search`;
    const outcome = (id: string) =>
      input.conversion.report.constructs.find((entry) => entry.id === id)?.outcome;
    // Both slug to queues/claims.json; whichever the inventory reads first owns it.
    expect([outcome(first), outcome(second)].sort()).toEqual(['converted', 'reported']);
    for (const number of [2, 5, 6, 7]) expect(run(input, number)?.findings).toEqual([]);
  });

  it('reports a button that runs on another document than the record, and writes no action', () => {
    for (const input of ['[[document.parentRef]]', 'a1b2c3', '']) {
      const converted = prepare({
        bundle: {
          [bundle]: files[bundle].replace(
            'input="[[document]]" params=',
            `input="${input}" params=`,
          ),
        },
      });
      expect(converted.conversion.app['actions.json']).toBeUndefined();
      expect(
        converted.conversion.report.constructs.find((entry) =>
          entry.label.includes('approveClaim'),
        ),
      ).toMatchObject({
        outcome: 'reported',
        note: expect.stringMatching(/runs on the open record/),
      });
      for (const number of [5, 7]) expect(run(converted, number)?.findings).toEqual([]);
      // Written anyway, it is an action no button of the package becomes.
      const written = edit(converted, 'actions.json', () => ({
        version: 2,
        actions: [{ id: 'acme-claims.approveClaim', label: 'Approve', operation: 'Claim.Approve' }],
      }));
      expect(run(written, 7)?.findings).toEqual([
        'actions.json: "acme-claims.approveClaim" runs something no button of the package runs',
      ]);
    }
  });

  it("holds a column's label to the column the queue shows, not to an earlier one under a condition", () => {
    const input = prepare({
      bundle: {
        [results]: files[results]
          .replace(
            '<nuxeo-data-table-column name="Reserve" field="cl:reserve">',
            '<nuxeo-data-table-column name="Restricted reserve" field="cl:reserve"><template><nuxeo-filter group="x"><template>[[item.properties.cl:reserve]]</template></nuxeo-filter></template></nuxeo-data-table-column><nuxeo-data-table-column name="Reserve" field="cl:reserve">',
          )
          .replace(
            '<template><nuxeo-filter group="adjusters"><template>[[item.properties.cl:reserve]]</template></nuxeo-filter></template></nuxeo-data-table-column>',
            '</nuxeo-data-table-column>',
          ),
      },
    });
    expect(input.conversion.app['queues/claims.json']).toMatchObject({
      columns: [{}, {}, { field: 'cl:reserve', label: 'Reserve' }],
    });
    for (const number of [2, 5, 6]) expect(run(input, number)?.findings).toEqual([]);
  });

  it('binds an action to another operation than the one it runs, whatever that is', () => {
    const input = prepare();
    const deleting = edit(input, 'actions.json', (file) => {
      file.actions[0].operation = 'Document.Delete';
      return file;
    });
    const mutation = MUTATIONS.find((m) => m.name === 'bind-other-operation');
    if (!mutation) throw new Error('bind-other-operation is missing');
    const broken = mutation.apply(deleting.conversion).conversion;
    expect(broken.app['actions.json']).toMatchObject({
      actions: [{ operation: 'Document.Trash' }],
    });
  });
});

describe('the home and the menu', () => {
  const bundle = `${UI}/nuxeo-Acme-Claims-bundle.html`;
  const home = `${UI}/nuxeo-home.html`;
  const files = syntheticBundleFiles();

  it('passes the home and the menu the conversion writes, in checks 5, 6, 7 and 10', () => {
    const input = prepare();
    expect(Object.keys(input.conversion.app)).toEqual(
      expect.arrayContaining(['home.json', 'navigation.json']),
    );
    for (const number of [5, 6, 7, 10]) expect(run(input, number)?.findings).toEqual([]);
  });

  it('fails a card or an entry that opens another list, or one the package does not have', () => {
    const input = prepare();
    const other = edit(input, 'navigation.json', (file) => {
      file.entries[0].queue = 'home-1-claims';
      file.entries.push({ id: 'extra', queue: 'claims' });
      return file;
    });
    expect(run(other, 7)?.findings).toEqual([
      'navigation.json: claimssearch opens "home-1-claims", where Web UI\'s menu entry "claimsSearch" opens queues/claims.json',
      'navigation.json: "extra" opens a list no menu entry of the package opens',
    ]);
    const missing = edit(input, 'home.json', () => undefined);
    expect(run(missing, 7)?.findings).toEqual([
      "home.json: card-1 is missing, though Web UI's dashboard card 1 opens queues/home-1-claims.json",
      "home.json: card-3 is missing, though Web UI's dashboard card 3 lists the person's tasks",
    ]);
  });

  it('fails a card or an entry named otherwise than Web UI names it', () => {
    const input = prepare();
    const renamed = edit(
      edit(input, 'home.json', (file) => {
        file.cards[0].label = 'All claims';
        return file;
      }),
      'navigation.json',
      (file) => {
        file.entries[0].label = 'Search';
        return file;
      },
    );
    expect(run(renamed, 6)?.findings).toEqual([
      'home.json: card-1: the app shows "All claims", where Web UI shows "Open claims"',
      'navigation.json: claimssearch: the app shows "Search", where Web UI shows "Claims"',
    ]);
  });

  it('fails a card or an entry for what Web UI shows only under a condition, or with a rule of its own', () => {
    const input = prepare({
      bundle: {
        [bundle]: files[bundle].replace(
          '<template><nuxeo-menu-icon name="claimssearch" label="Claims" icon="icons:search"></nuxeo-menu-icon></template>',
          '<template><nuxeo-filter group="adjusters"><template><nuxeo-menu-icon name="claimssearch" label="Claims" icon="icons:search"></nuxeo-menu-icon></template></nuxeo-filter></template>',
        ),
        [home]: files[home].replace(
          '<nuxeo-card heading="My tasks">',
          '<nuxeo-filter group="x"><template><nuxeo-card heading="Mine"><nuxeo-page-provider provider="claims"></nuxeo-page-provider><nuxeo-data-table><nuxeo-data-table-column name="Title"><template>[[item.title]]</template></nuxeo-data-table-column></nuxeo-data-table></nuxeo-card></template></nuxeo-filter><nuxeo-card heading="My tasks">',
        ),
      },
    });
    expect(input.conversion.app['navigation.json']).toBeUndefined();
    const widened = edit(
      edit(input, 'navigation.json', () => ({
        version: 2,
        entries: [{ id: 'claimssearch', label: 'Claims', queue: 'claims' }],
      })),
      'home.json',
      (file) => {
        file.cards.push({ id: 'card-3', queue: 'claims' });
        return file;
      },
    );
    expect(run(widened, 5)?.findings).toEqual([
      'home.json: card-3 shows card 3 to everyone, though Web UI shows it only while a condition passes',
      'navigation.json: claimssearch shows to everyone, though Web UI shows the menu entry "claimsSearch" only while a condition passes',
    ]);
    const ruled = edit(prepare(), 'home.json', (file) => {
      file.cards[0].visibleWhen = 'app.rules.canWrite';
      return file;
    });
    expect(run(ruled, 5)?.findings).toEqual([
      'home.json: cards.0.visibleWhen holds a rule that no condition of the package gives',
    ]);
  });

  it("refuses a card that names a queue the package does not have, by the validator's own rule", () => {
    const input = prepare();
    const unknown = edit(input, 'home.json', (file) => {
      file.cards[0].queue = 'nowhere';
      return file;
    });
    expect(run(unknown, 10)?.findings).toEqual([
      expect.stringMatching(
        /^app\/home\.json cards\[0\]\.queue: the queue "nowhere" is not in the package/,
      ),
    ]);
  });
});

// Found by the independent review of the home and the menu.
describe('what the review of the home and the menu found', () => {
  const bundle = `${UI}/nuxeo-Acme-Claims-bundle.html`;
  const files = syntheticBundleFiles();
  const form = `${UI}/search/claims/nuxeo-claims-search-form.html`;
  const results = `${UI}/search/claims/nuxeo-claims-search-results.html`;

  it('opens the search screen a form names, not the first on its page provider', () => {
    const input = prepare({
      bundle: {
        [`${UI}/search/archived/nuxeo-archived-search-form.html`]: files[form],
        [`${UI}/search/archived/nuxeo-archived-search-results.html`]: files[results],
        [bundle]:
          `<nuxeo-slot-content name="archivedSearch" slot="DRAWER_ITEMS" order="2"><template><nuxeo-menu-icon name="archivedsearch" label="Archived" icon="icons:archive"></nuxeo-menu-icon></template></nuxeo-slot-content>
          <nuxeo-slot-content name="archivedSearch" slot="DRAWER_PAGES"><template><nuxeo-search-form provider="claims" search-name="archived"></nuxeo-search-form></template></nuxeo-slot-content>` +
          files[bundle],
      },
    });
    // In Web UI's order: claimsSearch at 1 before archivedSearch at 2, whatever the file's order.
    expect(input.conversion.app['navigation.json']).toMatchObject({
      entries: [
        { id: 'claimssearch', label: 'Claims', queue: 'claims' },
        { id: 'archivedsearch', label: 'Archived', queue: 'archived' },
      ],
    });
    expect(input.conversion.app['queues/archived.json']).toMatchObject({ label: 'Archived' });
    expect(input.conversion.app['queues/claims.json']).toMatchObject({ label: 'Claims' });
    for (const number of [5, 6, 7, 10]) expect(run(input, number)?.findings).toEqual([]);
  });

  it('fails a home card that asks for a KPI, or a card or entry written twice', () => {
    const input = prepare();
    const kpi = edit(input, 'home.json', (file) => {
      file.cards[0].kpi = { pageProvider: 'some_other_pp' };
      return file;
    });
    expect(run(kpi, 7)?.findings).toEqual([
      "home.json: card-1 asks for a KPI, which Web UI's dashboard card 1 does not show",
    ]);
    const twice = edit(input, 'navigation.json', (file) => {
      file.entries.push({ ...file.entries[0], queue: 'home-1-claims' });
      return file;
    });
    expect(run(twice, 7)?.findings).toEqual([
      'navigation.json: claimssearch is there 2 times, not once',
    ]);
  });

  it('says why a menu entry is none: a page under a condition waits, a replaced one is reported', () => {
    const conditional = prepare({
      bundle: {
        [bundle]: files[bundle].replace(
          '<template><nuxeo-search-form provider="claims" search-name="claims" name="claimssearch"></nuxeo-search-form></template>',
          '<template><nuxeo-filter group="x"><template><nuxeo-search-form provider="claims" search-name="claims" name="claimssearch"></nuxeo-search-form></template></nuxeo-filter></template>',
        ),
      },
    });
    const entry = (input: HarnessInput, index: number) =>
      input.conversion.report.constructs.find(
        (candidate) => candidate.id === `slot-contribution:${bundle}#${index}`,
      );
    expect(conditional.conversion.app['navigation.json']).toBeUndefined();
    expect(entry(conditional, 3)).toMatchObject({
      outcome: 'reported',
      note: expect.stringMatching(/does not convert/),
    });
    const widened = edit(conditional, 'navigation.json', () => ({
      version: 2,
      entries: [{ id: 'claimssearch', queue: 'claims' }],
    }));
    expect(run(widened, 5)?.findings).toEqual([
      'navigation.json: claimssearch shows to everyone, though Web UI shows the menu entry "claimsSearch" only while a condition passes',
    ]);
    const repeated = prepare({
      bundle: {
        [bundle]: files[bundle].replace(
          '<nuxeo-slot-content name="claimsSearch" slot="DRAWER_PAGES">',
          '<nuxeo-slot-content name="claimsSearch" slot="DRAWER_ITEMS" order="2"><template><nuxeo-menu-icon name="again" label="Again" icon="icons:search"></nuxeo-menu-icon></template></nuxeo-slot-content><nuxeo-slot-content name="claimsSearch" slot="DRAWER_PAGES">',
        ),
      },
    });
    // Web UI's slot keeps the later contribution of a name (nuxeo-slots.js): the earlier one is
    // left out, and the later one is the entry.
    expect(entry(repeated, 3)).toMatchObject({
      outcome: 'reported',
      note: expect.stringContaining(
        'A later contribution of the same name, claimsSearch, replaces it',
      ),
    });
    expect(entry(repeated, 4)).toMatchObject({
      outcome: 'converted',
      to: 'navigation.json claimssearch',
    });
    expect(repeated.conversion.app['navigation.json']).toMatchObject({
      entries: [{ id: 'claimssearch', label: 'Again', order: 2 }],
    });
  });

  it('finds the entry an unnamed menu item under a condition would become, by its icon', () => {
    const input = prepare({
      bundle: {
        [bundle]: files[bundle]
          .replace(
            '<nuxeo-slot-content name="claimsSearch" slot="DRAWER_ITEMS" order="1">\n  <template><nuxeo-menu-icon',
            '<nuxeo-slot-content name="" slot="DRAWER_ITEMS" order="1">\n  <template><nuxeo-filter group="x"><template><nuxeo-menu-icon',
          )
          .replace(
            'icon="icons:search"></nuxeo-menu-icon></template>',
            'icon="icons:search"></nuxeo-menu-icon></template></nuxeo-filter></template>',
          ),
      },
    });
    const widened = edit(input, 'navigation.json', () => ({
      version: 2,
      entries: [{ id: 'claimssearch', queue: 'claims' }],
    }));
    expect(run(widened, 5)?.findings).toEqual([
      'navigation.json: claimssearch shows to everyone, though Web UI shows the menu entry "" only while a condition passes',
    ]);
  });
});

describe('M2: conditions become rules, held by truth tables', () => {
  const view = `${UI}/document/claim/nuxeo-claim-view-layout.html`;
  const bundle = `${UI}/nuxeo-Acme-Claims-bundle.html`;
  const home = `${UI}/nuxeo-home.html`;
  const files = syntheticBundleFiles();

  it('passes the rules the converter writes, and fails one that decides otherwise than Web UI', () => {
    const input = prepare();
    expect(run(input, 5)).toMatchObject({ status: 'partial', findings: [] });
    const inverted = edit(input, 'layouts/Claim/view.layout.json', (file) => {
      const field = file.cards[0].fields[3];
      field.visibleWhen = { type: 'app.rules.isType', parameters: ['Case'] };
      return file;
    });
    expect(run(inverted, 5)?.findings).toEqual([
      "layouts/Claim/view.layout.json: cards.0.fields.3.visibleWhen decides otherwise than Web UI's condition on 2 of 3 rows, such as type Claim",
    ]);
    const equivalent = edit(input, 'layouts/Claim/view.layout.json', (file) => {
      file.cards[0].fields[3].visibleWhen = {
        type: 'core.not',
        parameters: [
          { type: 'core.not', parameters: [{ type: 'app.rules.isType', parameters: ['Claim'] }] },
        ],
      };
      return file;
    });
    // Written otherwise, but deciding the same on every row: the truth table is the proof.
    expect(run(equivalent, 5)?.findings).toEqual([]);
  });

  it('fails a rule on what Web UI shows to everyone, and a converted field written without its rule', () => {
    const input = prepare();
    const moved = edit(input, 'layouts/Claim/view.layout.json', (file) => {
      file.cards[0].fields[0] = {
        field: 'cl:number',
        label: 'Claim number',
        visibleWhen: 'app.rules.canWrite',
      };
      return file;
    });
    expect(run(moved, 5)?.findings).toEqual([
      'layouts/Claim/view.layout.json: cards.0.fields.0.visibleWhen holds a rule that no condition of the package gives',
    ]);
    const dropped = edit(input, 'layouts/Claim/view.layout.json', (file) => {
      delete file.cards[0].fields[3].visibleWhen;
      return file;
    });
    expect(run(dropped, 5)?.findings).toEqual([
      'layouts/Claim/view.layout.json: it shows cl:reserve to everyone, though Web UI shows it only while condition 1 passes',
    ]);
  });

  it('writes nested conditions as one core.every, and holds it to both', () => {
    const input = prepare({
      bundle: {
        // A view that sets the user its group filter reads, as a nuxeo-connection does.
        [view]: files[view]
          .replace(
            '<nuxeo-filter document="[[document]]" type="Claim">\n      <template>',
            '<nuxeo-connection user="{{user}}"></nuxeo-connection><nuxeo-filter document="[[document]]" user="[[user]]" group="adjusters"><template><nuxeo-filter document="[[document]]" type="Claim">\n      <template>',
          )
          .replace(
            '</template>\n    </nuxeo-filter>',
            '</template>\n    </nuxeo-filter></template></nuxeo-filter>',
          ),
      },
    });
    const view1 = input.conversion.app['layouts/Claim/view.layout.json'] as {
      cards: { fields: unknown[] }[];
    };
    expect(view1.cards[0].fields[3]).toMatchObject({
      field: 'cl:reserve',
      visibleWhen: {
        type: 'core.every',
        parameters: [
          { type: 'app.rules.isType', parameters: ['Claim'] },
          { type: 'app.rules.inGroup', parameters: ['adjusters'] },
        ],
      },
    });
    expect(run(input, 5)?.findings).toEqual([]);
    const half = edit(input, 'layouts/Claim/view.layout.json', (file) => {
      file.cards[0].fields[3].visibleWhen = { type: 'app.rules.isType', parameters: ['Claim'] };
      return file;
    });
    expect(run(half, 5)?.findings).toEqual([
      expect.stringMatching(
        /cards\.0\.fields\.3\.visibleWhen decides otherwise than Web UI's condition/,
      ),
    ]);
  });

  it('holds an action to the condition its button sits in', () => {
    const allowList = new Set(['Claim.Approve', 'Claim.Close']);
    const pkg = readStudioPackage(syntheticPackage());
    const read = inventory(pkg);
    const input: HarnessInput = {
      pkg,
      inventory: read,
      catalogue,
      allowList,
      platformVersion: '0.2.0',
      conversion: convert(pkg, read, catalogue, { allowList, platformVersion: '0.2.0' }),
    };
    for (const number of [5, 7, 10]) expect(run(input, number)?.findings).toEqual([]);
    const inverted = edit(input, 'actions.json', (file) => {
      file.actions[1].visibleWhen = { type: 'core.not', parameters: ['app.rules.canWrite'] };
      return file;
    });
    expect(run(inverted, 5)?.findings).toEqual([
      expect.stringMatching(
        /^actions\.json: actions\.1\.visibleWhen decides otherwise than Web UI's condition/,
      ),
    ]);
  });

  describe('carries a group condition to the home and the menu, and reports one that reads a document there', () => {
    const groups = prepare({
      bundle: {
        // A home of the customer's own, which sets the user its filter reads.
        [home]: files[home].replace(
          '<nuxeo-card heading="My tasks">',
          '<nuxeo-connection user="{{user}}"></nuxeo-connection><nuxeo-filter user="[[user]]" group="supervisors"><template><nuxeo-card heading="Supervised"><nuxeo-page-provider provider="claims"></nuxeo-page-provider><nuxeo-data-table><nuxeo-data-table-column name="Title"><template>[[item.title]]</template></nuxeo-data-table-column></nuxeo-data-table></nuxeo-card></template></nuxeo-filter><nuxeo-card heading="My tasks">',
        ),
        [bundle]: files[bundle].replace(
          '<template><nuxeo-menu-icon name="claimssearch" label="Claims" icon="icons:search"></nuxeo-menu-icon></template>',
          '<template><nuxeo-filter user="[[user]]" group="adjusters"><template><nuxeo-menu-icon name="claimssearch" label="Claims" icon="icons:search"></nuxeo-menu-icon></template></nuxeo-filter></template>',
        ),
      },
    });

    it('writes it on the card, its queue and the menu entry, and passes checks 2, 5, 6, 7 and 10', () => {
      const rule = (group: string) => ({ type: 'app.rules.inGroup', parameters: [group] });
      expect(groups.conversion.app['home.json']).toMatchObject({
        cards: [
          { id: 'card-1' },
          { id: 'card-3', queue: 'home-3-claims', visibleWhen: rule('supervisors') },
          { id: 'card-4', tasks: {} },
        ],
      });
      expect(groups.conversion.app['queues/home-3-claims.json']).toMatchObject({
        visibleWhen: rule('supervisors'),
      });
      expect(groups.conversion.app['navigation.json']).toMatchObject({
        entries: [{ id: 'claimssearch', visibleWhen: rule('adjusters') }],
      });
      for (const number of [2, 5, 6, 7, 10]) expect(run(groups, number)?.findings).toEqual([]);
    });

    /** Every rule the package carries, the home's and the menu's among them. */
    const GROUP_RULES = [
      'home.json cards.1.visibleWhen',
      'layouts/Claim/view.layout.json cards.0.fields.3.visibleWhen',
      'navigation.json entries.0.visibleWhen',
      'queues/home-3-claims.json visibleWhen',
    ];

    // The cases below break these rules one by one: a rule the conversion gains is not left out.
    it('finds every rule the package carries, which the cases below break', () => {
      expect(ruleHolders(groups.conversion).map((found) => `${found.path} ${found.at}`)).toEqual(
        GROUP_RULES,
      );
    });

    // One case a rule and a change: each runs check 5 once. All of them in one test ran the whole
    // harness once a rule and a change, close to the time a test is given on a loaded runner.
    describe.each(['dropped', 'inverted'] as const)(
      'fails check 5 in its file on every rule %s, one by one',
      (change) => {
        it.each(GROUP_RULES)('%s', (where) => {
          const found = ruleHolders(groups.conversion).find(
            (holder) => `${holder.path} ${holder.at}` === where,
          );
          if (!found) throw new Error(`no rule at ${where}`);
          if (change === 'dropped') delete found.holder['visibleWhen'];
          else
            found.holder['visibleWhen'] = {
              type: 'core.not',
              parameters: [found.holder['visibleWhen']],
            };
          const findings = run(
            {
              ...groups,
              conversion: {
                ...groups.conversion,
                app: { ...groups.conversion.app, [found.path]: found.file },
              },
            },
            5,
          )?.findings;
          expect(findings?.some((f) => f.startsWith(`${found.path}: `))).toBe(true);
        });
      },
    );

    it('reports a menu entry whose condition reads a document, which the menu has not', () => {
      const typed = prepare({
        bundle: {
          [bundle]: files[bundle].replace(
            '<template><nuxeo-menu-icon name="claimssearch" label="Claims" icon="icons:search"></nuxeo-menu-icon></template>',
            '<template><nuxeo-filter document="[[document]]" type="Claim"><template><nuxeo-menu-icon name="claimssearch" label="Claims" icon="icons:search"></nuxeo-menu-icon></template></nuxeo-filter></template>',
          ),
        },
      });
      expect(typed.conversion.app['navigation.json']).toBeUndefined();
      expect(
        typed.conversion.report.constructs.find(
          (entry) => entry.id === `slot-contribution:${bundle}#3`,
        ),
      ).toMatchObject({
        outcome: 'reported',
        note: 'Its condition reads a document, and no record is open in the menu',
      });
    });
  });
});

describe('M2: where a condition cannot travel', () => {
  const view = `${UI}/document/claim/nuxeo-claim-view-layout.html`;
  const bundle = `${UI}/nuxeo-Acme-Claims-bundle.html`;
  const home = `${UI}/nuxeo-home.html`;
  const files = syntheticBundleFiles();
  const outcome = (input: HarnessInput, id: string) =>
    input.conversion.report.constructs.find((entry) => entry.id === id);

  it('takes a user only from what sets it, not from a declaration or a comment', () => {
    const input = prepare({
      bundle: {
        [view]: files[view]
          .replace(
            'document: { type: Object }',
            'document: { type: Object }, user: { type: Object }',
          )
          .replace(
            '<nuxeo-filter document="[[document]]" type="Claim">',
            '<!-- <nuxeo-connection user="{{user}}"></nuxeo-connection> --><nuxeo-filter user="[[user]]" group="adjusters">',
          ),
      },
    });
    expect(outcome(input, `condition:${view}#1`)).toMatchObject({
      outcome: 'reported',
      note: expect.stringMatching(/which its file does not hold/),
    });
    expect(JSON.stringify(input.conversion.app['layouts/Claim/view.layout.json'])).not.toContain(
      'cl:reserve',
    );
    expect(run(input, 5)?.findings).toEqual([]);
  });

  it('holds a field to the condition around where it shows its property, not around a hint', () => {
    const shown = (body: string) => {
      const input = prepare({
        bundle: {
          [view]: files[view].replace(
            '</template>\n  <script>',
            `${body}\n  </template>\n  <script>`,
          ),
        },
      });
      const file = input.conversion.app['layouts/Claim/view.layout.json'] as {
        cards: { fields: unknown[] }[];
      };
      return {
        input,
        field: file.cards[0].fields.find((field) => JSON.stringify(field).includes('cl:adjuster')),
      };
    };
    const hint = shown(
      '<div role="widget"><label>Adjuster</label><nuxeo-filter document="[[document]]" permission="Remove"><template><span>Ask a supervisor</span></template></nuxeo-filter><div>[[document.properties.cl:adjuster]]</div></div>',
    );
    expect(hint.field).toEqual({ field: 'cl:adjuster', label: 'Adjuster' });
    expect(run(hint.input, 5)?.findings).toEqual([]);
    const value = shown(
      '<div role="widget"><label>Adjuster</label><nuxeo-filter document="[[document]]" permission="Remove"><template><div>[[document.properties.cl:adjuster]]</div></template></nuxeo-filter></div>',
    );
    expect(value.field).toMatchObject({ field: 'cl:adjuster', visibleWhen: 'app.rules.canRemove' });
    expect(run(value.input, 5)?.findings).toEqual([]);
    // Shown in two places under two conditions: which one Web UI shows is either's, so a person decides.
    const twice = shown(
      '<div role="widget"><label>Adjuster</label><nuxeo-filter document="[[document]]" permission="Remove"><template><div>[[document.properties.cl:adjuster]]</div></template></nuxeo-filter><nuxeo-filter document="[[document]]" state="open"><template><div>[[document.properties.cl:adjuster]]</div></template></nuxeo-filter></div>',
    );
    expect(twice.field).toBeUndefined();
    expect(run(twice.input, 5)?.findings).toEqual([]);
    // Shown under a filter, and again under one inside it: the outer one is enough.
    const nested = shown(
      '<div role="widget"><label>Adjuster</label><nuxeo-filter document="[[document]]" permission="Remove"><template><div>[[document.properties.cl:adjuster]]</div><nuxeo-filter document="[[document]]" state="open"><template><div>[[document.properties.cl:adjuster]]</div></template></nuxeo-filter></template></nuxeo-filter></div>',
    );
    expect(nested.field).toMatchObject({ visibleWhen: 'app.rules.canRemove' });
    expect(run(nested.input, 5)?.findings).toEqual([]);
    // Text a dom-if holds shows only while its `if` passes, so the field waits on its rule.
    const domIf = shown(
      '<div role="widget"><label>Adjuster</label><template is="dom-if" if="[[hasFacet(document, \'Versionable\')]]">[[document.properties.cl:adjuster]]</template></div>',
    );
    expect(domIf.field).toBeUndefined();
    expect(
      domIf.input.conversion.report.constructs.find(
        (entry) => entry.kind === 'layout-field' && entry.property === 'cl:adjuster',
      ),
    ).toMatchObject({ outcome: 'proposed' });
  });

  it('holds an action to the condition around its button, and a card to the one around its list', () => {
    const input = prepare({
      bundle: {
        [bundle]: files[bundle].replace(
          'params=\'{"comment": "Approved in Web UI"}\'></nuxeo-operation-button>',
          'params=\'{"comment": "Approved in Web UI"}\'></nuxeo-operation-button><nuxeo-filter document="[[document]]" type="Claim"><template><paper-tooltip>Claims only</paper-tooltip></template></nuxeo-filter>',
        ),
        [home]: files[home].replace(
          '<nuxeo-card heading="My tasks">',
          '<nuxeo-card heading="Hinted"><nuxeo-filter user="[[user]]" group="g"><template><span>For g</span></template></nuxeo-filter><nuxeo-page-provider provider="claims"></nuxeo-page-provider><nuxeo-data-table><nuxeo-data-table-column name="Title"><template>[[item.title]]</template></nuxeo-data-table-column></nuxeo-data-table></nuxeo-card>' +
            // A filter of no test passes for everyone.
            '<nuxeo-filter><template><nuxeo-card heading="Open"><nuxeo-page-provider provider="claims"></nuxeo-page-provider><nuxeo-data-table><nuxeo-data-table-column name="Title"><template>[[item.title]]</template></nuxeo-data-table-column></nuxeo-data-table></nuxeo-card></template></nuxeo-filter>' +
            '<nuxeo-card heading="My tasks">',
        ),
      },
    });
    const actions = (input.conversion.app['actions.json'] as { actions: { id: string }[] }).actions;
    expect(actions.find((action) => action.id.endsWith('approveClaim'))).not.toHaveProperty(
      'visibleWhen',
    );
    const cards = (input.conversion.app['home.json'] as { cards: { queue?: string }[] }).cards;
    for (const queue of ['home-3-claims', 'home-4-claims']) {
      expect(cards.find((card) => card.queue === queue)).not.toHaveProperty('visibleWhen');
      expect(input.conversion.app[`queues/${queue}.json`]).not.toHaveProperty('visibleWhen');
    }
    for (const number of [2, 5, 7, 10]) expect(run(input, number)?.findings).toEqual([]);
  });

  it("leaves out a card's column under a condition that does not convert, reports the card, and fails a queue that shows it", () => {
    const input = prepare({
      bundle: {
        [home]: files[home].replace(
          '<nuxeo-card heading="My tasks">',
          '<nuxeo-card heading="Reserves"><nuxeo-page-provider provider="claims"></nuxeo-page-provider><nuxeo-data-table><nuxeo-data-table-column name="Title"><template>[[item.title]]</template></nuxeo-data-table-column><nuxeo-data-table-column name="Reserve"><template><nuxeo-filter document="[[item]]" permission="Write"><template>[[item.properties.cl:reserve]]</template></nuxeo-filter></template></nuxeo-data-table-column></nuxeo-data-table></nuxeo-card><nuxeo-card heading="My tasks">',
        ),
      },
    });
    const queue = input.conversion.app['queues/home-3-claims.json'];
    expect(JSON.stringify(queue)).not.toContain('cl:reserve');
    expect(queue).not.toHaveProperty('visibleWhen');
    // Written without the column, and reported, so that a person decides it.
    expect(outcome(input, `dashboard-card:${home}#3`)).toMatchObject({
      outcome: 'reported',
      to: 'home.json card-3, its list in queues/home-3-claims.json',
      note: expect.stringMatching(
        /^Written without what Web UI shows of it: its column 2, cl:reserve, is left out: Condition 1 of its file does not convert: Its permission test, Write, is no registered rule/,
      ),
    });
    for (const number of [2, 5, 6, 7, 10]) expect(run(input, number)?.findings).toEqual([]);
    const widened = edit(input, 'queues/home-3-claims.json', (file) => {
      file.columns.push({ field: 'cl:reserve' });
      return file;
    });
    expect(run(widened, 5)?.findings).toEqual([
      'queues/home-3-claims.json: it shows the column cl:reserve to everyone, though Web UI shows it only while a condition passes',
    ]);
    // The same property again, in a column of its own in no condition: the queue shows that one,
    // and check 6 names it as that column, not as the one left out.
    const both = prepare({
      bundle: {
        [home]: files[home].replace(
          '<nuxeo-card heading="My tasks">',
          '<nuxeo-card heading="Reserves"><nuxeo-page-provider provider="claims"></nuxeo-page-provider><nuxeo-data-table><nuxeo-data-table-column name="Reserve (adjusters)"><template><nuxeo-filter document="[[item]]" permission="Write"><template>[[item.properties.cl:reserve]]</template></nuxeo-filter></template></nuxeo-data-table-column><nuxeo-data-table-column name="Reserve"><template>[[item.properties.cl:reserve]]</template></nuxeo-data-table-column></nuxeo-data-table></nuxeo-card><nuxeo-card heading="My tasks">',
        ),
      },
    });
    expect(both.conversion.app['queues/home-3-claims.json']).toMatchObject({
      columns: [{ field: 'cl:reserve', label: 'Reserve' }],
    });
    for (const number of [2, 5, 6]) expect(run(both, number)?.findings).toEqual([]);
  });

  it('reports a field that names its property both in a condition and outside it', () => {
    const input = prepare({
      bundle: {
        [view]: files[view].replace(
          '</template>\n  <script>',
          '<div role="widget" hidden$="[[!document.properties.cl:adjuster]]"><label>Adjuster</label><nuxeo-filter document="[[document]]" permission="Write, WriteProperties"><template><span>[[document.properties.cl:adjuster]]</span></template></nuxeo-filter></div>\n  </template>\n  <script>',
        ),
      },
    });
    expect(JSON.stringify(input.conversion.app['layouts/Claim/view.layout.json'])).not.toContain(
      'cl:adjuster',
    );
    expect(
      input.conversion.report.constructs.find(
        (entry) => entry.kind === 'layout-field' && entry.property === 'cl:adjuster',
      ),
    ).toMatchObject({
      outcome: 'reported',
      note: expect.stringMatching(
        /names cl:adjuster inside condition \d+ of its file and outside it too/,
      ),
    });
    expect(run(input, 5)?.findings).toEqual([]);
    const widened = edit(input, 'layouts/Claim/view.layout.json', (file) => {
      file.cards[0].fields.push({ field: 'cl:adjuster' });
      return file;
    });
    expect(run(widened, 5)?.findings).toEqual([
      expect.stringMatching(
        /it shows cl:adjuster to everyone, though Web UI shows it only while condition \d+ passes/,
      ),
    ]);
  });

  it('reports a field holding a condition that may show its value by other means than naming it', () => {
    const input = prepare({
      bundle: {
        [view]: files[view].replace(
          '</template>\n  <script>',
          '<div role="widget" hidden$="[[!document.properties.file:content]]"><label>File</label><nuxeo-filter document="[[document]]" permission="Write, WriteProperties"><template><nuxeo-document-blob document="[[document]]" xpath="file:content"></nuxeo-document-blob></template></nuxeo-filter></div>\n  </template>\n  <script>',
        ),
      },
    });
    expect(JSON.stringify(input.conversion.app['layouts/Claim/view.layout.json'])).not.toContain(
      'file:content',
    );
    expect(
      input.conversion.report.constructs.find(
        (entry) => entry.kind === 'layout-field' && entry.property === 'file:content',
      ),
    ).toMatchObject({
      outcome: 'reported',
      note: expect.stringMatching(/may show file:content by other means than naming it/),
    });
    expect(run(input, 5)?.findings).toEqual([]);
    const widened = edit(input, 'layouts/Claim/view.layout.json', (file) => {
      file.cards[0].fields.push({ field: 'file:content' });
      return file;
    });
    expect(run(widened, 5)?.findings).toEqual([
      expect.stringMatching(
        /it shows file:content to everyone, though Web UI shows it only while condition \d+ passes/,
      ),
    ]);
    // An element of its own with nothing bound, or a helper's binding with no element: either may
    // show the value.
    for (const shows of [
      '<acme-reserve></acme-reserve>',
      '<span>[[_reserveOf(document)]]</span>',
    ]) {
      const other = prepare({
        bundle: {
          [view]: files[view].replace(
            '</template>\n  <script>',
            `<div role="widget" hidden$="[[!document.properties.cl:adjuster]]"><label>Adjuster</label><nuxeo-filter document="[[document]]" permission="Remove"><template>${shows}</template></nuxeo-filter></div>\n  </template>\n  <script>`,
          ),
        },
      });
      expect(
        other.conversion.report.constructs.find(
          (entry) => entry.kind === 'layout-field' && entry.property === 'cl:adjuster',
        ),
      ).toMatchObject({ outcome: 'reported', note: expect.stringMatching(/by other means/) });
    }
  });

  it("holds a menu entry to its page's search form, not to a button beside it", () => {
    const input = prepare({
      bundle: {
        [bundle]: files[bundle].replace(
          '<template><nuxeo-search-form provider="claims" search-name="claims" name="claimssearch"></nuxeo-search-form></template>',
          '<template><nuxeo-operation-button operation="Claim.Export" input="[[document]]"></nuxeo-operation-button><nuxeo-filter user="[[user]]" group="adjusters"><template><nuxeo-search-form provider="claims" search-name="claims" name="claimssearch"></nuxeo-search-form></template></nuxeo-filter></template>',
        ),
      },
    });
    expect(input.conversion.app['navigation.json']).toMatchObject({
      entries: [
        {
          id: 'claimssearch',
          visibleWhen: { type: 'app.rules.inGroup', parameters: ['adjusters'] },
        },
      ],
    });
    expect(run(input, 5)?.findings).toEqual([]);
    const dropped = edit(input, 'navigation.json', (file) => {
      delete file.entries[0].visibleWhen;
      return file;
    });
    expect(run(dropped, 5)?.findings).toEqual([
      expect.stringMatching(/^navigation\.json: claimssearch shows to everyone/),
    ]);
  });

  it("reports a menu entry whose and whose page's conditions together are too large to table", () => {
    const groups = (prefix: string) =>
      Array.from({ length: 9 }, (_, index) => `${prefix}${index}`).join(', ');
    const input = prepare({
      bundle: {
        [bundle]: files[bundle]
          .replace(
            '<template><nuxeo-menu-icon name="claimssearch" label="Claims" icon="icons:search"></nuxeo-menu-icon></template>',
            `<template><nuxeo-filter user="[[user]]" group="${groups('g')}"><template><nuxeo-menu-icon name="claimssearch" label="Claims" icon="icons:search"></nuxeo-menu-icon></template></nuxeo-filter></template>`,
          )
          .replace(
            '<template><nuxeo-search-form provider="claims" search-name="claims" name="claimssearch"></nuxeo-search-form></template>',
            `<template><nuxeo-filter user="[[user]]" group="${groups('h')}"><template><nuxeo-search-form provider="claims" search-name="claims" name="claimssearch"></nuxeo-search-form></template></nuxeo-filter></template>`,
          ),
      },
    });
    expect(input.conversion.app['navigation.json']).toBeUndefined();
    expect(outcome(input, `slot-contribution:${bundle}#3`)).toMatchObject({
      outcome: 'reported',
      note: expect.stringMatching(/together would run \d+ rows/),
    });
    expect(run(input, 5)?.findings).toEqual([]);
  });

  it('keeps the field that shows a property to everyone, and reports a copy under a condition', () => {
    const input = prepare({
      bundle: {
        [view]: files[view].replace(
          '</template>\n  <script>',
          '<div role="widget"><label>Reserve</label><div>[[document.properties.cl:reserve]]</div></div>\n  </template>\n  <script>',
        ),
      },
    });
    const fields = (
      input.conversion.app['layouts/Claim/view.layout.json'] as { cards: { fields: unknown[] }[] }
    ).cards[0].fields;
    expect(fields.filter((field) => JSON.stringify(field).includes('cl:reserve'))).toEqual([
      { field: 'cl:reserve', label: 'Reserve' },
    ]);
    expect(outcome(input, `layout-field:${view}#4`)).toMatchObject({
      outcome: 'reported',
      note: expect.stringMatching(/another field of the layout shows it to everyone/),
    });
    for (const number of [2, 5]) expect(run(input, number)?.findings).toEqual([]);
  });

  it('reports a bulk action whose condition reads the open record, which a selection has not', () => {
    const allowList = new Set(['Claim.Approve', 'Claim.Bulk']);
    const pkg = readStudioPackage(
      syntheticPackage({
        bundle: {
          [bundle]: `<nuxeo-slot-content name="bulk" slot="RESULTS_SELECTION_ACTIONS"><template><nuxeo-filter document="[[document]]" type="Claim"><template><nuxeo-operation-button operation="Claim.Bulk" label="Bulk" input="[[selectedItems]]"></nuxeo-operation-button></template></nuxeo-filter></template></nuxeo-slot-content>`,
        },
      }),
    );
    const read = inventory(pkg);
    const conversion = convert(pkg, read, catalogue, { allowList, platformVersion: '0.2.0' });
    expect(conversion.app['actions.json']).toBeUndefined();
    expect(
      conversion.report.constructs.find((entry) => entry.id === `slot-contribution:${bundle}#1`),
    ).toMatchObject({
      outcome: 'reported',
      note: 'Its condition reads the open record, and an action over a selection has none',
    });
  });

  it('reports a dashboard card whose condition reads a document, which the home has not', () => {
    const input = prepare({
      bundle: {
        [home]: files[home].replace(
          '<nuxeo-card heading="My tasks">',
          '<nuxeo-filter document="[[document]]" type="Claim"><template><nuxeo-card heading="Typed"><nuxeo-page-provider provider="claims"></nuxeo-page-provider><nuxeo-data-table><nuxeo-data-table-column name="Title"><template>[[item.title]]</template></nuxeo-data-table-column></nuxeo-data-table></nuxeo-card></template></nuxeo-filter><nuxeo-card heading="My tasks">',
        ),
      },
    });
    expect(input.conversion.app['queues/home-3-claims.json']).toBeUndefined();
    expect(outcome(input, `dashboard-card:${home}#3`)).toMatchObject({
      outcome: 'reported',
      note: 'Its condition reads a document, and no record is open on the home',
    });
    // The checks hold it to no queue and no home card of its own.
    for (const number of [2, 5, 7, 10]) expect(run(input, number)?.findings).toEqual([]);
  });
});

describe('the verdict', () => {
  it('counts a partial check as a blocker, never as a pass', () => {
    const result = runHarness(prepare());
    expect(
      result.checks.filter((check) => check.status === 'partial').map((c) => c.number),
    ).toEqual([3, 5, 6, 7]);
    expect(result.blockers.filter((line) => line.endsWith('ran only in part'))).toHaveLength(4);
    expect(result.ready).toBe(false);
  });
});
