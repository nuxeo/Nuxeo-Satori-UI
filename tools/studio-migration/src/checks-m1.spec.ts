import { loadCatalogue } from './catalogue';
import { versionOne } from './check-package';
import { readable } from './check-seen';
import { convert, type Conversion } from './convert';
import { runHarness, type HarnessInput } from './harness';
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

const run = (input: HarnessInput, number: number) =>
  runHarness(input).checks.find((check) => check.number === number);

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
      file.sections[0].fields.push('cl:amount');
      return file;
    });
    expect(run(extra, 2)?.findings).toEqual([
      "layouts/Claim/edit.layout.json: it shows cl:amount, which Web UI's layout does not",
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
    const named = edit(input, 'layouts/Claim/edit.layout.json', (file) => {
      file.sections[0].fields[1] = { field: 'cl:incidentDate', widget: 'date' };
      return file;
    });
    expect(run(named, 2)?.findings).toContain(
      'layouts/Claim/edit.layout.json: sections.0.fields.1 names a widget, which version 1 cannot do and ignores',
    );
  });

  it('fails on a file of the wrong version for its mode', () => {
    const v2 = edit(input, 'layouts/Claim/edit.layout.json', (file) => ({ ...file, version: 2 }));
    expect(run(v2, 2)?.findings).toContain(
      'layouts/Claim/edit.layout.json: it is not version 1, which the app reads in edit mode',
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
          '</template>',
          '<nuxeo-directory-suggestion role="widget" value="[[document.properties.cl:adjuster]]" directory-name="adjusters"></nuxeo-directory-suggestion></template>',
        ),
      },
    });
    expect(run(vocabulary, 2)?.findings).toEqual([]);
    const other = edit(vocabulary, 'layouts/Claim/view.layout.json', (file) => {
      file.cards[0].fields[3].parameters.directory = 'others';
      return file;
    });
    expect(run(other, 2)?.findings).toEqual([
      'layouts/Claim/view.layout.json: cl:adjuster\'s vocabulary widget has the parameters {"directory":"others"}, not {"directory":"adjusters"}',
    ]);
  });

  it('accepts a field the report reports, with its reason, as accounted for', () => {
    const dropped = edit(input, 'layouts/Claim/edit.layout.json', (file) => {
      file.sections[0].fields.pop();
      return file;
    });
    // cl:adjuster is reported: version 1 cannot show it as a user picker.
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
      'layouts/Claim/view.layout.json cards.0.fields.3: the schema party has no field name, so pt:name does not exist',
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
      'layouts/Claim/view.layout.json cards.0.fields.3: the type Claim has no party schema, so it has no pt:name',
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
    const none = prepare({
      without: [`${UI}/document/claim/nuxeo-claim-metadata-layout.html`],
      bundle: {
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
      'queues/claims.json: visibleWhen holds a rule that no condition of the package gives: M1 converts no condition',
    ]);
    const required = edit(input, 'layouts/Claim/edit.layout.json', (file) => {
      file.sections[0].fields[0].required = 'app.rules.canWrite';
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
      /2 labels rest on a catalogue the package does not hold: Web UI's claim\.amount\.heading, the app's claim\.amount\.heading/,
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

  it('fails when the report says a button became an action that is not there', () => {
    const missing = edit(input, 'actions.json', () => undefined);
    expect(run(missing, 7)?.findings).toEqual([
      'actions.json: acme-claims.approveClaim is missing, though the report says "approveClaim" became it',
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
