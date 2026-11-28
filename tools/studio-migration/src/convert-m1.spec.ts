import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCatalogue } from './catalogue';
import { convert, ConversionError, writeConversion, type Conversion } from './convert';
import { inventory } from './inventory';
import { readStudioPackage } from './studio-package';
import {
  syntheticBundleFiles,
  syntheticPackage,
  type SyntheticPackageOptions,
} from './testing/synthetic-package';

const UI = 'web/nuxeo.war/ui';
const catalogue = loadCatalogue();

function converted(
  options?: SyntheticPackageOptions,
  allowList: ReadonlySet<string> = new Set(['Claim.Approve']),
): Conversion {
  const pkg = readStudioPackage(syntheticPackage(options));
  return convert(pkg, inventory(pkg), catalogue, { allowList, platformVersion: '0.2.0' });
}

const outcome = (conversion: Conversion, id: string) =>
  conversion.report.constructs.find((entry) => entry.id === id);

const layout = (name: string, body: string, type = 'Claim'): string => `<dom-module id="${name}">
  <template>${body}</template>
  <script>
    Polymer({ is: '${name}', behaviors: [Nuxeo.LayoutBehavior],
      properties: { /** @doctype ${type} */ document: { type: Object } } });
  </script>
</dom-module>`;

describe('M1 converts document layouts', () => {
  const conversion = converted();

  it('writes view in layout version 2, with each widget the element becomes', () => {
    expect(conversion.app['layouts/Claim/view.layout.json']).toEqual({
      version: 2,
      cards: [
        {
          id: 'fields',
          fields: [
            { field: 'cl:number', label: 'Claim number' },
            { field: 'cl:amount', label: 'Amount' },
            { field: 'cl:incidentDate', label: 'Incident date', widget: 'date' },
            // Under nuxeo-filter type="Claim": the rule it becomes travels with it.
            {
              field: 'cl:reserve',
              label: 'Reserve',
              visibleWhen: { type: 'app.rules.isType', parameters: ['Claim'] },
            },
          ],
        },
      ],
    });
  });

  it('proposes the rule of a dom-if in a known pattern, and writes its field only once it is accepted', () => {
    const path = `${UI}/document/claim/nuxeo-claim-view-layout.html`;
    expect(outcome(conversion, `condition:${path}#2`)).toMatchObject({
      outcome: 'proposed',
      rule: { type: 'app.rules.hasFacet', parameters: ['Versionable'] },
    });
    expect(outcome(conversion, `layout-field:${path}#5`)).toMatchObject({
      outcome: 'proposed',
      property: 'cl:tags',
    });
    expect(JSON.stringify(conversion.app['layouts/Claim/view.layout.json'])).not.toContain(
      'cl:tags',
    );
  });

  it('writes edit in version 2, which the app draws, and metadata in version 1, which it reads alone', () => {
    // Each widget as its element gives it, as the view's are: a form of version 2 names them.
    expect(conversion.app['layouts/Claim/edit.layout.json']).toEqual({
      version: 2,
      cards: [
        {
          id: 'fields',
          fields: [
            { field: 'cl:number', label: 'Claim number', required: true },
            { field: 'cl:incidentDate', label: 'Incident date', widget: 'date' },
            { field: 'cl:adjuster', label: 'Adjuster', widget: 'user' },
          ],
        },
      ],
    });
    // The Properties panel shows Title itself; the field under a condition is reported.
    expect(conversion.app['layouts/Claim/metadata.layout.json']).toEqual({
      version: 1,
      sections: [
        {
          id: 'fields',
          fields: [
            { field: 'cl:number', label: 'Claim number' },
            { field: 'cl:adjuster', label: 'Adjuster' },
          ],
        },
      ],
    });
  });

  it('writes a field version 1 cannot show as Web UI does, and reports it', () => {
    // An edit form is version 2 now, and names the user widget: converted.
    expect(
      outcome(conversion, `layout-field:${UI}/document/claim/nuxeo-claim-edit-layout.html#3`),
    ).toMatchObject({ outcome: 'converted', to: 'layouts/Claim/edit.layout.json' });
    // The metadata layout is still version 1: a user tag there shows as its schema type picks.
    expect(
      outcome(conversion, `layout-field:${UI}/document/claim/nuxeo-claim-metadata-layout.html#4`),
    ).toMatchObject({
      outcome: 'reported',
      property: 'cl:adjuster',
      to: 'layouts/Claim/metadata.layout.json',
      note: expect.stringMatching(/version 1 cannot name the user widget/),
    });
  });

  it('reports a version 1 field under a condition, as version 1 has no rules, and leaves it out', () => {
    const path = `${UI}/document/claim/nuxeo-claim-metadata-layout.html`;
    // Its own condition does not convert, and its report says so first.
    expect(outcome(conversion, `layout-field:${path}#3`)).toMatchObject({
      outcome: 'reported',
      property: 'cl:reserve',
      note: expect.stringMatching(/given \[\[user\]\], which its file does not hold/),
    });
    // One whose condition converts is reported too, for version 1's reason.
    const connected = converted({
      bundle: {
        [path]: syntheticBundleFiles()[path].replace(
          '<template>\n    <div role="widget"><label>Title</label>',
          '<template>\n    <nuxeo-connection user="{{user}}"></nuxeo-connection>\n    <div role="widget"><label>Title</label>',
        ),
      },
    });
    expect(outcome(connected, `layout-field:${path}#3`)).toMatchObject({
      outcome: 'reported',
      property: 'cl:reserve',
      note: expect.stringMatching(
        /condition 1 of its file passes, and version 1 has no rules: the app reads its metadata layout in version 1 alone/,
      ),
    });
    expect(connected.app['layouts/Claim/metadata.layout.json']).toEqual(
      conversion.app['layouts/Claim/metadata.layout.json'],
    );
    // Its condition guards nothing that will carry it: it is reported, not left pending.
    expect(outcome(connected, `condition:${path}#1`)).toMatchObject({
      outcome: 'reported',
      note: expect.stringMatching(/nothing it guards carries it, and nothing will/),
    });
    // Its group test is given [[user]], which a document layout does not hold: it never passes.
    expect(outcome(conversion, `condition:${path}#1`)).toMatchObject({
      outcome: 'reported',
      note: expect.stringMatching(/given \[\[user\]\], which its file does not hold/),
    });
    expect(outcome(conversion, `layout-field:${path}#1`)).toMatchObject({
      outcome: 'converted',
      to: expect.stringMatching(/Properties panel's own row for dc:title/),
    });
  });

  it('converts a condition only where its rule is written, and leaves one nothing carries pending or reported', () => {
    const edit = `${UI}/document/claim/nuxeo-claim-edit-layout.html`;
    const typed = converted({
      bundle: {
        [edit]: syntheticBundleFiles()
          [edit].replace(
            '<nuxeo-user-suggestion role="widget"',
            '<nuxeo-filter document="[[document]]" type="Claim"><template><nuxeo-user-suggestion role="widget"',
          )
          .replace(
            '</nuxeo-user-suggestion>',
            '</nuxeo-user-suggestion></template></nuxeo-filter>',
          ),
      },
    });
    // Its one field is in an edit form, of version 2: the rule is written on it.
    expect(outcome(typed, `condition:${edit}#1`)).toMatchObject({
      outcome: 'converted',
      to: 'the visibleWhen of layouts/Claim/edit.layout.json cl:adjuster',
    });
    const view = `${UI}/document/claim/nuxeo-claim-view-layout.html`;
    expect(outcome(typed, `condition:${view}#1`)).toMatchObject({
      outcome: 'converted',
      to: 'the visibleWhen of layouts/Claim/view.layout.json cl:reserve',
    });
    // A menu entry that opens no queue waits for the mapping agent, and its condition with it.
    const bundle = `${UI}/nuxeo-Acme-Claims-bundle.html`;
    const menu = converted({
      bundle: {
        [bundle]: syntheticBundleFiles()[bundle].replace(
          '<!-- <nuxeo-slot-content name="retired"',
          `<nuxeo-slot-content name="reports" slot="DRAWER_ITEMS" order="3">
  <template><nuxeo-filter user="[[user]]" group="managers"><template><nuxeo-menu-icon name="reports" label="Reports" icon="icons:assessment"></nuxeo-menu-icon></template></nuxeo-filter></template>
</nuxeo-slot-content>
<!-- <nuxeo-slot-content name="retired"`,
        ),
      },
    });
    expect(outcome(menu, `condition:${bundle}#2`)).toMatchObject({
      outcome: 'pending',
      note: expect.stringMatching(/nothing it guards carries one yet/),
    });
  });

  it('reports an import layout, which has no place in the app, with each of its fields', () => {
    const path = `${UI}/document/claim/nuxeo-claim-import-layout.html`;
    const withImport = converted({
      bundle: {
        [path]: layout(
          'nuxeo-claim-import-layout',
          '<nuxeo-input role="widget" value="{{document.properties.dc:title}}" label="Title"></nuxeo-input>',
        ),
      },
    });
    expect(outcome(withImport, `layout:${path}#layout`)).toMatchObject({
      outcome: 'reported',
      note: expect.stringMatching(/^The app has no import form/),
    });
    expect(outcome(withImport, `layout-field:${path}#1`)).toMatchObject({ outcome: 'reported' });
    expect(Object.keys(withImport.app).some((file) => file.includes('import'))).toBe(false);
  });

  it('writes no view file for a layout that only shows the preview, and an empty metadata file for one the panel covers', () => {
    const view = `${UI}/document/claim/nuxeo-claim-view-layout.html`;
    const metadata = `${UI}/document/claim/nuxeo-claim-metadata-layout.html`;
    const only = converted({
      bundle: {
        [view]: layout(
          'nuxeo-claim-view-layout',
          '<nuxeo-document-viewer role="widget" role="widget" document="[[document]]"></nuxeo-document-viewer>',
        ),
        [metadata]: layout(
          'nuxeo-claim-metadata-layout',
          '<div role="widget"><label>Title</label><div>[[document.properties.dc:title]]</div></div>',
        ),
      },
    });
    expect(only.app['layouts/Claim/view.layout.json']).toBeUndefined();
    expect(outcome(only, `layout:${view}#layout`)).toMatchObject({
      outcome: 'converted',
      to: expect.stringMatching(/^no file: the app's document page/),
    });
    expect(outcome(only, `layout-field:${view}#1`)).toMatchObject({
      outcome: 'converted',
      to: expect.stringMatching(/preview/),
    });
    // No file would show every schema of the type, more than Web UI did.
    expect(only.app['layouts/Claim/metadata.layout.json']).toEqual({ version: 1, sections: [] });
  });

  it('writes a field bound twice once, and reports the repeat', () => {
    const path = `${UI}/document/claim/nuxeo-claim-edit-layout.html`;
    const twice = converted({
      bundle: {
        [path]: layout(
          'nuxeo-claim-edit-layout',
          `<nuxeo-input role="widget" value="{{document.properties.cl:number}}" label="Claim number"></nuxeo-input>
           <nuxeo-input role="widget" value="{{document.properties.cl:number}}" label="Number again"></nuxeo-input>`,
        ),
      },
    });
    expect(twice.app['layouts/Claim/edit.layout.json']).toEqual({
      version: 2,
      cards: [{ id: 'fields', fields: [{ field: 'cl:number', label: 'Claim number' }] }],
    });
    expect(outcome(twice, `layout-field:${path}#2`)).toMatchObject({
      outcome: 'reported',
      note: 'It binds cl:number again, and is kept once',
    });
  });

  it('reports an element the catalogue does not know rather than guessing its widget', () => {
    const path = `${UI}/document/claim/nuxeo-claim-view-layout.html`;
    const unknown = converted({
      bundle: {
        [path]: layout(
          'nuxeo-claim-view-layout',
          '<acme-gauge role="widget" value="[[document.properties.cl:amount]]"></acme-gauge>',
        ),
      },
    });
    expect(outcome(unknown, `layout-field:${path}#1`)).toMatchObject({
      outcome: 'reported',
      note: 'acme-gauge is not a field element the catalogue knows',
    });
  });

  it('names a vocabulary widget with its directory, and a relative date as one', () => {
    const path = `${UI}/document/claim/nuxeo-claim-view-layout.html`;
    const widgets = converted({
      bundle: {
        [path]: layout(
          'nuxeo-claim-view-layout',
          `<nuxeo-directory-suggestion role="widget" value="[[document.properties.dc:nature]]" directory-name="nature" label="Nature"></nuxeo-directory-suggestion>
           <nuxeo-date role="widget" datetime="[[document.properties.dc:modified]]" format="relative"></nuxeo-date>
           <nuxeo-user-suggestion role="widget" value="[[document.properties.cl:adjuster]]" search-type="GROUP_TYPE"></nuxeo-user-suggestion>`,
        ),
      },
    });
    expect(widgets.app['layouts/Claim/view.layout.json']).toMatchObject({
      cards: [
        {
          fields: [
            {
              field: 'dc:nature',
              label: 'Nature',
              widget: 'vocabulary',
              parameters: { directory: 'nature' },
            },
            { field: 'dc:modified', widget: 'relative-date' },
            { field: 'cl:adjuster', widget: 'group' },
          ],
        },
      ],
    });
  });
});

describe('M1 converts search screens and the dashboard into queues', () => {
  const conversion = converted();

  it('writes the results as a queue over the same page provider, named as the menu names it', () => {
    expect(conversion.app['queues/claims.json']).toEqual({
      version: 2,
      label: 'Claims',
      pageProvider: 'claims',
      columns: [
        { field: 'dc:title', label: 'Title' },
        { field: 'cl:amount', label: 'Amount' },
      ],
      sort: [{ field: 'cl:amount', order: 'desc' }],
    });
  });

  it('reports the form and its fields, which a queue cannot let anyone fill in', () => {
    const form = `${UI}/search/claims/nuxeo-claims-search-form.html`;
    expect(outcome(conversion, `search:${form}#search`)).toMatchObject({ outcome: 'reported' });
    expect(outcome(conversion, `search-field:${form}#1`)).toMatchObject({
      outcome: 'reported',
      note: expect.stringMatching(/It fills the predicate cl_number/),
    });
  });

  it('reports a grid view, which a queue does not have', () => {
    const path = `${UI}/search/claims/nuxeo-claims-search-results.html`;
    const grid = converted({
      bundle: {
        [path]: syntheticBundleFiles()[path].replace(
          '</nuxeo-results>',
          '<nuxeo-data-grid name="grid"><template><nuxeo-document-grid-thumbnail></nuxeo-document-grid-thumbnail></template></nuxeo-data-grid></nuxeo-results>',
        ),
      },
    });
    expect(outcome(grid, `search-view:${path}#1`)).toMatchObject({ outcome: 'converted' });
    expect(outcome(grid, `search-view:${path}#2`)).toMatchObject({
      outcome: 'reported',
      note: expect.stringMatching(/has no grid view/),
    });
  });

  it("writes a dashboard card's list as a queue, and the card as a card of home.json naming it", () => {
    expect(conversion.app['queues/home-1-claims.json']).toEqual({
      version: 2,
      label: 'Open claims',
      pageProvider: 'claims',
      parameters: ['open'],
      columns: [
        { field: 'dc:title', label: 'Title' },
        { field: 'cl:incidentDate', label: 'Incident', widget: 'relative-date' },
      ],
      pageSize: 20,
    });
    expect(outcome(conversion, `dashboard-card:${UI}/nuxeo-home.html#1`)).toMatchObject({
      outcome: 'converted',
      to: 'home.json card-1, its list in queues/home-1-claims.json',
    });
    // The tasks card is a card of the person's tasks, of every workflow.
    expect(conversion.app['home.json']).toEqual({
      version: 2,
      cards: [
        { id: 'card-1', label: 'Open claims', queue: 'home-1-claims' },
        { id: 'card-3', label: 'My tasks', tasks: {} },
      ],
    });
    expect(conversion.app['queues/home-2-claims.json']).toBeUndefined();
    expect(outcome(conversion, `dashboard-card:${UI}/nuxeo-home.html#3`)).toMatchObject({
      outcome: 'converted',
      to: 'home.json card-3',
      note: expect.stringMatching(/open tasks of every workflow/),
    });
  });

  it('leaves a card fed by an operation for an agent to propose, and reports one a queue cannot ask for', () => {
    const home = `${UI}/nuxeo-home.html`;
    const cards = converted({
      bundle: {
        [home]: `<dom-module id="nuxeo-home"><template>
          <nuxeo-card heading="Favourites"><nuxeo-operation op="Favorite.Fetch"></nuxeo-operation><nuxeo-page-provider provider="default_content_collection"></nuxeo-page-provider></nuxeo-card>
          <nuxeo-card heading="Mine"><nuxeo-page-provider provider="mine" params='{"owner": "[[user.id]]"}'></nuxeo-page-provider></nuxeo-card>
        </template></dom-module>`,
      },
    });
    expect(outcome(cards, `dashboard-card:${home}#1`)).toMatchObject({
      outcome: 'proposed',
      note: expect.stringMatching(/Favorite\.Fetch/),
    });
    expect(outcome(cards, `dashboard-card:${home}#2`)).toMatchObject({
      outcome: 'reported',
      note: expect.stringMatching(/named parameters \(owner\)/),
    });
  });
});

describe('M1 converts slot contributions', () => {
  const conversion = converted();
  const bundle = `${UI}/nuxeo-Acme-Claims-bundle.html`;

  it('makes an allowed operation button an action, with its operation, parameters, icon and order', () => {
    expect(conversion.app['actions.json']).toEqual({
      version: 2,
      actions: [
        {
          id: 'acme-claims.approveClaim',
          label: 'Approve',
          icon: 'check',
          order: 10,
          operation: 'Claim.Approve',
          parameters: { comment: 'Approved in Web UI' },
        },
      ],
    });
    expect(outcome(conversion, `slot-contribution:${bundle}#1`)).toMatchObject({
      outcome: 'converted',
      to: 'actions.json acme-claims.approveClaim',
    });
  });

  it('reports a button whose operation is not on the allow-list, and writes no action', () => {
    const refused = converted(undefined, new Set());
    expect(refused.app['actions.json']).toBeUndefined();
    expect(outcome(refused, `slot-contribution:${bundle}#1`)).toMatchObject({
      outcome: 'reported',
      note: expect.stringMatching(/Claim\.Approve, is not on the deployment's allow-list/),
    });
  });

  it("makes a button under a condition an action that carries the condition's rule", () => {
    const allowed = converted(undefined, new Set(['Claim.Approve', 'Claim.Close']));
    expect(outcome(allowed, `slot-contribution:${bundle}#2`)).toMatchObject({
      outcome: 'converted',
      to: 'actions.json acme-claims.closeClaim',
    });
    expect(allowed.app['actions.json']).toMatchObject({
      actions: [{}, { id: 'acme-claims.closeClaim', visibleWhen: 'app.rules.canWrite' }],
    });
  });

  it('reports a button under a condition that does not convert, whatever the allow-list says', () => {
    const files = syntheticBundleFiles();
    const allowed = converted(
      {
        bundle: {
          [bundle]: files[bundle].replace(
            'permission="Write, WriteProperties"',
            'permission="Write"',
          ),
        },
      },
      new Set(['Claim.Approve', 'Claim.Close']),
    );
    expect(outcome(allowed, `slot-contribution:${bundle}#2`)).toMatchObject({
      outcome: 'reported',
      note: expect.stringMatching(/permission test, Write, is no registered rule/),
    });
    expect(JSON.stringify(allowed.app['actions.json'])).not.toContain('Claim.Close');
  });

  it('makes the left menu entry an entry of navigation.json that opens its search screen', () => {
    expect(conversion.app['navigation.json']).toEqual({
      version: 2,
      entries: [{ id: 'claimssearch', label: 'Claims', icon: 'search', order: 1, queue: 'claims' }],
    });
    expect(outcome(conversion, `slot-contribution:${bundle}#3`)).toMatchObject({
      outcome: 'converted',
      to: 'navigation.json claimssearch',
    });
    expect(outcome(conversion, `slot-contribution:${bundle}#4`)).toMatchObject({
      outcome: 'converted',
      to: 'queues/claims.json, which the menu entry navigation.json claimssearch opens',
    });
  });

  it('leaves a menu entry that opens no queue pending, and writes no navigation.json for it', () => {
    const other = converted({
      bundle: {
        [bundle]: `<nuxeo-slot-content name="reports" slot="DRAWER_ITEMS"><template><nuxeo-menu-icon name="reports" label="Reports" icon="icons:assessment"></nuxeo-menu-icon></template></nuxeo-slot-content>
          <nuxeo-slot-content name="reports" slot="DRAWER_PAGES"><template><acme-reports></acme-reports></template></nuxeo-slot-content>`,
      },
    });
    expect(other.app['navigation.json']).toBeUndefined();
    expect(outcome(other, `slot-contribution:${bundle}#1`)).toMatchObject({
      outcome: 'pending',
      note: expect.stringMatching(/opens no queue this conversion writes/),
    });
  });

  it('names the theme in app.json, and reports a theme the package does not hold', () => {
    expect(conversion.app['app.json']).toEqual({
      version: 2,
      id: 'acme-claims',
      label: 'Acme-Claims',
      packageVersion: '1.0.0',
      platform: '>=0.2.0 <1.0.0',
      groups: ['members'],
      branding: { theme: 'acme' },
    });
    const missing = converted({
      bundle: {
        [bundle]:
          '<nuxeo-slot-content name="other" slot="THEMES"><template><nuxeo-theme name="other"></nuxeo-theme></template></nuxeo-slot-content>',
      },
    });
    expect(outcome(missing, `slot-contribution:${bundle}#1`)).toMatchObject({
      outcome: 'reported',
      note: 'It names a theme, other, the package does not hold',
    });
    expect(missing.app['app.json']).not.toHaveProperty('branding');
  });

  it('reports a button whose parameters are bound to the page', () => {
    const bound = converted({
      bundle: {
        [bundle]: `<nuxeo-slot-content name="b" slot="DOCUMENT_ACTIONS"><template><nuxeo-operation-button operation="Claim.Approve" input="[[document]]" params="[[params]]"></nuxeo-operation-button></template></nuxeo-slot-content>`,
      },
    });
    expect(outcome(bound, `slot-contribution:${bundle}#1`)).toMatchObject({
      outcome: 'reported',
      note: expect.stringMatching(/bound to the page/),
    });
  });
});

describe('M1 writes labels, images and the files themselves', () => {
  it('writes each language as a version 2 labels file, and reports a key the labels file refuses', () => {
    const conversion = converted({
      bundle: {
        'data/i18n/messages.json': JSON.stringify({
          'label.claim.number': 'Claim number',
          'bad key': 'x',
        }),
      },
    });
    expect(conversion.app['labels/en.json']).toEqual({
      version: 2,
      labels: { 'label.claim.number': 'Claim number' },
    });
    expect(outcome(conversion, 'translation:data/i18n/messages.json#bad key')).toMatchObject({
      outcome: 'reported',
      note: expect.stringMatching(/^The app's labels refuse it: a label key is/),
    });
  });

  it('keeps an image the model names on the server, and reports one nothing names', () => {
    const named = converted({
      bundle: {
        'OSGI-INF/extensions.xml': syntheticBundleFiles()['OSGI-INF/extensions.xml'].replace(
          '</component>',
          '<extension target="org.nuxeo.ecm.platform.types.TypeService" point="types"><type id="Claim"><icon>/img/login.jpg</icon></type></extension></component>',
        ),
      },
    });
    expect(outcome(named, 'file:web/nuxeo.war/img/login.jpg#file')).toMatchObject({
      outcome: 'server',
    });
    expect(outcome(converted(), 'file:web/nuxeo.war/img/login.jpg#file')).toMatchObject({
      outcome: 'reported',
    });
  });

  it('refuses to write a file whose path is not a safe name on every system', () => {
    const conversion = converted();
    const unsafe = { ...conversion, app: { ...conversion.app, 'layouts/../x.layout.json': {} } };
    const out = join(mkdtempSync(join(tmpdir(), 'studio-m1-')), 'out');
    expect(() => writeConversion(out, unsafe)).toThrow(ConversionError);
  });

  it('decides every construct, so none is left to the fallback', () => {
    for (const entry of converted().report.constructs)
      expect(entry.note ?? '').not.toBe('The conversion did not reach it');
  });
});
