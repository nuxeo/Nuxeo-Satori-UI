import { loadCatalogue, scriptEntry } from './catalogue';
import { classify, inventory } from './inventory';
import { readStudioPackage } from './studio-package';
import {
  SYNTHETIC_BUNDLE,
  syntheticBundleFiles,
  syntheticPackage,
} from './testing/synthetic-package';

const UI = 'web/nuxeo.war/ui';
const of = (options?: Parameters<typeof syntheticPackage>[0]) =>
  inventory(readStudioPackage(syntheticPackage(options)));

describe('inventory', () => {
  const synthetic = of();

  it('gives every file a kind, and none of the synthetic package is unrecognised', () => {
    expect(synthetic.files).toHaveLength(4 + Object.keys(syntheticBundleFiles()).length);
    expect(synthetic.files.filter((file) => file.kind === 'unrecognised')).toEqual([]);
    const kinds = Object.fromEntries(synthetic.files.map((file) => [file.path, file.kind]));
    expect(kinds).toMatchObject({
      'package.xml': 'package-descriptor',
      'install.xml': 'package-install',
      'studio-registries.json': 'package-registries',
      [SYNTHETIC_BUNDLE]: 'bundle',
      'OSGI-INF/deployment-fragment.xml': 'deployment-fragment',
      'OSGI-INF/extensions.xml': 'model-contributions',
      [`${UI}/nuxeo-Acme-Claims-custom-bundle.html`]: 'custom-bundle',
      [`${UI}/nuxeo-Acme-Claims-bundle.html`]: 'slot-contributions',
      [`${UI}/themes/acme/logo.png`]: 'theme-asset',
      'data/i18n/messages-fr.json': 'translations',
    });
    expect(synthetic.problems).toEqual([]);
  });

  it('lists a file it does not know as unrecognised, never drops it', () => {
    const result = of({
      bundle: { [`${UI}/mystery/review/nuxeo-review-panel.html`]: '<p></p>' },
    });
    expect(
      result.files.filter((file) => file.kind === 'unrecognised').map((file) => file.path),
    ).toEqual([`${UI}/mystery/review/nuxeo-review-panel.html`]);
    expect(classify('notes.txt', 'package', SYNTHETIC_BUNDLE)).toBe('unrecognised');
  });

  it('counts the model contributions by extension point', () => {
    expect(synthetic.model.map((m) => [m.point, m.contributions])).toEqual([
      ['schema', 2],
      ['doctype', 2],
      ['providers', 1],
    ]);
  });

  it('reads each layout: its type, mode and bound fields', () => {
    expect(synthetic.layouts.map((l) => [l.element, l.docType, l.mode])).toEqual([
      ['nuxeo-claim-view-layout', 'Claim', 'view'],
      ['nuxeo-claim-edit-layout', 'Claim', 'edit'],
      ['nuxeo-claim-metadata-layout', 'Claim', 'metadata'],
    ]);
    const fields = (index: number) =>
      synthetic.layouts[index].fields.map(({ element, binding, label, required, condition }) => ({
        element,
        binding,
        label,
        required,
        condition,
      }));
    expect(fields(0)).toEqual([
      {
        element: 'div',
        binding: 'cl:number',
        label: 'Claim number',
        required: false,
        condition: null,
      },
      { element: 'div', binding: 'cl:amount', label: 'Amount', required: false, condition: null },
      {
        element: 'nuxeo-date',
        binding: 'cl:incidentDate',
        label: 'Incident date',
        required: false,
        condition: null,
      },
      { element: 'div', binding: 'cl:reserve', label: 'Reserve', required: false, condition: 0 },
      { element: 'div', binding: 'cl:tags', label: 'Tags', required: false, condition: 1 },
    ]);
    expect(fields(1)).toEqual([
      {
        element: 'nuxeo-input',
        binding: 'cl:number',
        label: 'Claim number',
        required: true,
        condition: null,
      },
      {
        element: 'nuxeo-date-picker',
        binding: 'cl:incidentDate',
        label: 'Incident date',
        required: false,
        condition: null,
      },
      {
        element: 'nuxeo-user-suggestion',
        binding: 'cl:adjuster',
        label: 'Adjuster',
        required: false,
        condition: null,
      },
    ]);
    expect(synthetic.layouts[1].fields[0].attributes).toMatchObject({ type: 'text', required: '' });
  });

  it('records the condition a field sits in, and every condition of the Web UI files', () => {
    expect(synthetic.layouts[2].fields.map((field) => [field.binding, field.condition])).toEqual([
      ['dc:title', null],
      ['cl:number', null],
      ['cl:reserve', 0],
    ]);
    expect(synthetic.conditions.map((c) => [c.path, c.index, c.element, c.attributes])).toEqual([
      [
        `${UI}/document/claim/nuxeo-claim-view-layout.html`,
        0,
        'nuxeo-filter',
        { document: '[[document]]', type: 'Claim' },
      ],
      [
        `${UI}/document/claim/nuxeo-claim-view-layout.html`,
        1,
        'template',
        { is: 'dom-if', if: "[[hasFacet(document, 'Versionable')]]" },
      ],
      [
        `${UI}/document/claim/nuxeo-claim-metadata-layout.html`,
        0,
        'nuxeo-filter',
        { document: '[[document]]', user: '[[user]]', group: 'adjusters' },
      ],
      [
        `${UI}/search/claims/nuxeo-claims-search-results.html`,
        0,
        'nuxeo-filter',
        { group: 'adjusters' },
      ],
      [
        `${UI}/nuxeo-Acme-Claims-bundle.html`,
        0,
        'nuxeo-filter',
        { document: '[[document]]', permission: 'Write, WriteProperties' },
      ],
    ]);
    const domIf = of({
      bundle: {
        [`${UI}/document/claim/nuxeo-claim-view-layout.html`]: syntheticBundleFiles()
          [`${UI}/document/claim/nuxeo-claim-view-layout.html`].replace(
            '<div role="widget"><label>Amount</label>',
            '<template is="dom-if" if="[[document.properties.cl:amount]]"><div role="widget"><label>Amount</label>',
          )
          .replace(
            '[[document.properties.cl:amount]]</div></div>',
            '[[document.properties.cl:amount]]</div></div></template>',
          ),
      },
    });
    expect(domIf.layouts[0].fields.map((field) => field.condition)).toEqual([null, 0, null, 1, 2]);
    expect(domIf.conditions[0]).toMatchObject({
      element: 'template',
      attributes: { is: 'dom-if' },
    });
  });

  it('reads the search screen, giving the results their form provider', () => {
    expect(
      synthetic.searches.map((s) => [s.part, s.provider, s.fields.length, s.columns, s.views]),
    ).toEqual([
      ['form', 'claims', 2, 0, []],
      ['results', 'claims', 0, 3, ['nuxeo-data-table']],
    ]);
    expect(synthetic.searches[0].fields.map((f) => f.binding)).toEqual(['cl_number', 'cl_status']);
  });

  it("reads the results' columns and the sorts their script offers, without running it", () => {
    const [, results] = synthetic.searches;
    expect(results.columnDetails.map((c) => [c.name, c.field, c.sortBy])).toEqual([
      ['Title', 'dc:title', 'dc:title'],
      ['Amount', 'cl:amount', null],
      ['Reserve', 'cl:reserve', null],
    ]);
    expect(results.sortOptions).toEqual([
      { field: 'dc:title', order: 'asc', selected: false },
      { field: 'cl:amount', order: 'desc', selected: true },
    ]);
    expect(synthetic.searches[0].sortOptions).toEqual([]);
  });

  it('reads the slot contributions, and not the one inside a comment', () => {
    expect(synthetic.slotContributions.map((s) => [s.slot, s.name, s.order, s.elements])).toEqual([
      ['DOCUMENT_ACTIONS', 'approveClaim', 10, ['nuxeo-operation-button']],
      ['DOCUMENT_ACTIONS', 'closeClaim', 20, ['nuxeo-filter', 'nuxeo-operation-button']],
      ['DRAWER_ITEMS', 'claimsSearch', 1, ['nuxeo-menu-icon']],
      ['DRAWER_PAGES', 'claimsSearch', null, ['nuxeo-search-form']],
      ['THEMES', 'acme', null, ['nuxeo-theme']],
    ]);
    expect(synthetic.slotContributions.map((s) => s.operations)).toEqual([
      ['Claim.Approve'],
      ['Claim.Close'],
      [],
      [],
      [],
    ]);
    expect(synthetic.slotContributions.map((s) => s.conditions)).toEqual([[], [0], [], [], []]);
    expect(synthetic.slotContributions[0].parts).toEqual([
      {
        element: 'nuxeo-operation-button',
        attributes: {
          icon: 'icons:check',
          label: 'Approve',
          operation: 'Claim.Approve',
          input: '[[document]]',
          params: '{"comment": "Approved in Web UI"}',
        },
      },
    ]);
  });

  it('tells a custom bundle with code from one with only comments', () => {
    expect(synthetic.customCode).toEqual([
      { path: `${UI}/nuxeo-Acme-Claims-custom-bundle.html`, hasCode: false, hasOtherCode: false },
    ]);
    const withCode = of({
      bundle: {
        [`${UI}/nuxeo-Acme-Claims-custom-bundle.html`]:
          '<!-- x --><script>Polymer({is:"acme-x"})</script>',
      },
    });
    expect(withCode.customCode[0].hasCode).toBe(true);
    // A script outside a dom-module is no custom element: it is the bundle's other code.
    expect(withCode.customCode[0].hasOtherCode).toBe(true);
    expect(withCode.customElements).toEqual([]);
  });

  it('reads the dashboard cards, marks the repeat, and skips the one inside a comment', () => {
    const elements = [
      'nuxeo-page-provider',
      'nuxeo-data-table',
      'nuxeo-data-table-column',
      'nuxeo-data-table-column',
      'nuxeo-date',
    ];
    expect(
      synthetic.dashboard?.cards.map(({ heading, elements, repeatOf }) => ({
        heading,
        elements,
        repeatOf,
      })),
    ).toEqual([
      { heading: 'Open claims', elements, repeatOf: null },
      { heading: 'Open claims', elements, repeatOf: 0 },
      { heading: 'My tasks', elements: ['nuxeo-tasks-list'], repeatOf: null },
    ]);
    expect(synthetic.dashboard?.cards[0]).toMatchObject({
      provider: 'claims',
      pageSize: 20,
      params: '{"queryParams": "open"}',
      operation: null,
      conditional: false,
    });
    // A column with no `field` shows the property its template binds, or the title.
    expect(synthetic.dashboard?.cards[0].columns.map((c) => [c.field, c.dateFormat])).toEqual([
      ['dc:title', null],
      ['cl:incidentDate', 'relative'],
    ]);
  });

  it('reads each theme: its properties, mixins included, and its assets', () => {
    expect(synthetic.themes).toHaveLength(1);
    const [theme] = synthetic.themes;
    expect(theme.name).toBe('acme');
    expect(theme.properties.map((p) => [p.name, p.mixin])).toEqual([
      ['--nuxeo-primary-color', false],
      ['--nuxeo-text-default', false],
      ['--nuxeo-sidebar-background', false],
      ['--paper-input-container', true],
      ['--primary-text-color', false],
    ]);
    expect(theme.assets).toEqual([`${UI}/themes/acme/logo.png`]);
  });

  it('reads the translations by language', () => {
    expect(synthetic.translations.map((t) => [t.locale, t.keys.length])).toEqual([
      ['en', 3],
      ['fr', 3],
    ]);
  });

  it('counts the custom elements, leaving out the two wrappers and anything commented out', () => {
    expect(Object.fromEntries(synthetic.elements)).toEqual({
      'nuxeo-data-table-column': 7,
      'nuxeo-slot-content': 5,
      'nuxeo-data-table': 3,
      'nuxeo-card': 3,
      'nuxeo-date': 3,
      'nuxeo-filter': 4,
      'nuxeo-input': 2,
      'nuxeo-operation-button': 2,
      'nuxeo-page-provider': 2,
      'nuxeo-date-picker': 1,
      'nuxeo-directory-suggestion': 1,
      'nuxeo-menu-icon': 1,
      'nuxeo-results': 1,
      'nuxeo-search-form': 1,
      'nuxeo-tasks-list': 1,
      'nuxeo-theme': 1,
      'nuxeo-user-suggestion': 1,
    });
    expect(synthetic.elements.has('dom-module')).toBe(false);
    expect(synthetic.elements.has('nuxeo-menu-item')).toBe(false);
  });

  it('records a file it cannot read as a problem and carries on', () => {
    const result = of({
      bundle: {
        'data/i18n/messages-de.json': '{ not json',
        'OSGI-INF/broken.xml': '<component><extension></component>',
      },
    });
    expect(result.problems.map((p) => p.path).sort()).toEqual([
      'OSGI-INF/broken.xml',
      'data/i18n/messages-de.json',
    ]);
    expect(result.translations.map((t) => t.locale)).toEqual(['en', 'fr']);
    expect(result.layouts).toHaveLength(3);
  });

  it('records every script, and the synthetic ones have the shapes of the templates Studio generates', () => {
    const catalogue = loadCatalogue();
    expect(synthetic.scripts.map((s) => [s.path.split('/').pop(), s.index])).toEqual([
      ['nuxeo-claim-view-layout.html', 0],
      ['nuxeo-claim-edit-layout.html', 0],
      ['nuxeo-claim-metadata-layout.html', 0],
      ['nuxeo-claims-search-form.html', 0],
      ['nuxeo-claims-search-results.html', 0],
    ]);
    expect(synthetic.scripts.map((s) => scriptEntry(catalogue, s.shape)?.name)).toEqual([
      "Studio's document layout",
      "Studio's document layout",
      "Studio's document layout",
      "Studio's search form",
      "Studio's search results",
    ]);
  });

  it('gives a script with customer code in it a shape no template has', () => {
    const path = `${UI}/document/claim/nuxeo-claim-view-layout.html`;
    const original = syntheticBundleFiles()[path];
    const result = of({
      bundle: {
        [path]: original.replace('behaviors:', 'ready: function() { this.track(); }, behaviors:'),
      },
    });
    const script = result.scripts.find((s) => s.path === path);
    expect(script && scriptEntry(loadCatalogue(), script.shape)).toBeNull();
  });

  // Negative controls for what review found the first version got wrong.
  it('finds no kind on the prototype for a file named constructor or __proto__', () => {
    for (const name of ['constructor', '__proto__', 'toString']) {
      expect(classify(name, 'package', SYNTHETIC_BUNDLE)).toBe('unrecognised');
    }
  });

  it('calls two cards a repeat only when their whole markup is the same', () => {
    const path = `${UI}/nuxeo-home.html`;
    const home = (secondColumn: string) => `<dom-module id="nuxeo-home"><template>
      <nuxeo-card heading="Open claims"><nuxeo-data-table><nuxeo-data-table-column name="Title" field="dc:title"></nuxeo-data-table-column></nuxeo-data-table></nuxeo-card>
      <nuxeo-card heading="Open claims"><nuxeo-data-table>
        <nuxeo-data-table-column name="Title" field="${secondColumn}"></nuxeo-data-table-column>
      </nuxeo-data-table></nuxeo-card>
    </template></dom-module>`;
    expect(of({ bundle: { [path]: home('dc:title') } }).dashboard?.cards[1].repeatOf).toBe(0);
    expect(of({ bundle: { [path]: home('cl:amount') } }).dashboard?.cards[1].repeatOf).toBeNull();
  });

  it('finds code in a custom bundle by parsing it, however its comments are written', () => {
    const path = `${UI}/nuxeo-Acme-Claims-custom-bundle.html`;
    const hasCode = (markup: string) => of({ bundle: { [path]: markup } }).customCode[0].hasCode;
    expect(hasCode('<!-- one -->\n<!-- two -->\n')).toBe(false);
    expect(hasCode('<!-- a --><script>Polymer({ is: "acme-x" })</script>')).toBe(true);
    expect(hasCode('<!<!--- comment --->><link rel="import" href="acme.html">')).toBe(true);
    expect(hasCode('<!-- a -->stray text')).toBe(true);
  });
});
