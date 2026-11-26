import { validateActions } from './actions';
import { addressTakenById, validateApp } from './app';
import type { Finding } from './checker';
import { validateLabels, validateModuleSettings } from './labels';
import { validateLayoutV2, validateTaskForm } from './layout-v2';
import { validateQueue } from './queue';
import { PACKAGED_REGISTRIES, withRegistered } from './registries';
import { compareVersions, parseRange, parseVersion, satisfies } from './semver';

// The validators of the files beside the layouts (docs/business-apps/app-definition-v2.md). Each
// table row is a negative control: an input wrong in one way, whose findings must be exactly these.

const show = (findings: Finding[]): string[] =>
  findings.map((finding) => `${finding.path}: ${finding.message} [${finding.kind}]`);
const withCases = withRegistered(PACKAGED_REGISTRIES, { modules: ['cases'] });

type Row = { readonly what: string; readonly input: unknown; readonly found: readonly string[] };

describe('app.json', () => {
  const app = (keys: Record<string, unknown> = {}): Record<string, unknown> => ({
    version: 2,
    id: 'claims',
    label: 'Claims',
    packageVersion: '1.0.0',
    platform: '>=0.2.0 <1.0.0',
    groups: ['members'],
    ...keys,
  });
  const without = (key: string): Record<string, unknown> => {
    const content = app();
    delete content[key];
    return content;
  };

  it('passes a sound one, its range held to the platform when the caller knows the version', () => {
    expect(show(validateApp(app()))).toEqual([]);
    const branded = app({
      address: 'claims-desk',
      modules: ['cases'],
      branding: {
        applicationTitle: 'Claims',
        theme: 'payers',
        logo: { src: 'assets/logo.svg', alt: 'Payers' },
        favicon: null,
      },
    });
    expect(show(validateApp(branded, { registries: withCases, platformVersion: '0.5.0' }))).toEqual(
      [],
    );
    // An id that is a platform route passes with an address of its own: the address is where the
    // shell opens it.
    expect(show(validateApp(app({ id: 'contracts', address: 'contract-desk' })))).toEqual([]);
  });

  it('says, and does not refuse, an id that is a platform route with no address', () => {
    // Refused, it would refuse the contracts kit, built before the rule; the command says it.
    expect(show(validateApp(app({ id: 'contracts' })))).toEqual([]);
    expect(addressTakenById(app({ id: 'contracts' }))).toBe(
      `with no "address", the app's address is its id, "contracts", which is the platform's own page, /contracts: give the app an "address" no platform route has`,
    );
    expect(addressTakenById(app({ id: 'contracts', address: 'contract-desk' }))).toBeUndefined();
    expect(addressTakenById(app({ id: 'claims' }))).toBeUndefined();
    expect(addressTakenById([])).toBeUndefined();
  });

  const rows: readonly Row[] = [
    { what: 'not an object', input: [], found: [': an app.json is a JSON object [structure]'] },
    {
      what: 'no id',
      input: without('id'),
      found: [
        'id: needs an id: lower-case letters, digits and "-", starting with a letter [structure]',
      ],
    },
    {
      what: 'no name',
      input: without('label'),
      found: [': needs a "label" or a "labelKey" [structure]'],
    },
    {
      what: 'an address that is not a path segment',
      input: app({ address: 'Claims Desk' }),
      found: [
        'address: an address is lower-case letters, digits and "-", starting with a letter [structure]',
      ],
    },
    {
      what: "an address that is one of the platform's routes",
      input: app({ address: 'contracts' }),
      found: [
        `address: the address "contracts" is the platform's own page, /contracts: choose one no platform route has [structure]`,
      ],
    },
    {
      what: 'an address that is a route under settings/, which is reserved whole',
      input: app({ address: 'settings' }),
      found: [
        `address: the address "settings" is the platform's own page, /settings: choose one no platform route has [structure]`,
      ],
    },
    {
      what: 'a version that is not semantic',
      input: app({ packageVersion: '1.0' }),
      found: [`packageVersion: needs the package's semantic version, such as "1.4.0" [structure]`],
    },
    {
      what: 'a platform that is not a range',
      input: app({ platform: 'latest' }),
      found: [
        'platform: needs the range of platform versions it runs on, such as ">=1.0.0 <2.0.0", "^1.2.0" or "~1.2.0" [structure]',
      ],
    },
    {
      what: 'no groups',
      input: app({ groups: [] }),
      found: ['groups: needs the groups the app is for: "members" is everyone [structure]'],
    },
    {
      what: 'a group with a space around it',
      input: app({ groups: ['members', ' adjusters'] }),
      found: ['groups[1]: a group is the name of a Nuxeo group [structure]'],
    },
    {
      what: 'a group twice',
      input: app({ groups: ['members', 'members'] }),
      found: ['groups[1]: the group "members" is listed twice [structure]'],
    },
    {
      what: 'modules that are not a list',
      input: app({ modules: 'cases' }),
      found: ['modules: modules must be a list [structure]'],
    },
    {
      what: 'a module not named by its id',
      input: app({ modules: ['Cases'] }),
      found: ['modules[0]: a module is named by its id [structure]'],
    },
    {
      what: 'a module the platform does not have',
      input: app({ modules: ['cases'] }),
      found: ['modules[0]: the module "cases" is not registered [unknown]'],
    },
    {
      what: 'branding that is not an object',
      input: app({ branding: 'blue' }),
      found: ['branding: branding is an object [structure]'],
    },
    {
      what: 'an empty title',
      input: app({ branding: { applicationTitle: ' ' } }),
      found: ['branding.applicationTitle: must be a text [structure]'],
    },
    {
      what: 'a theme that is not an id',
      input: app({ branding: { theme: '' } }),
      found: [`branding.theme: theme is the id of one of the server's themes [structure]`],
    },
    {
      what: 'a logo that is not an image',
      input: app({ branding: { logo: 'logo.svg' } }),
      found: ['branding.logo: an image is { "src": <source>, "alt": <text> }, or null [structure]'],
    },
    {
      what: 'a logo over plain http',
      input: app({ branding: { logo: { src: 'http://example.com/logo.svg' } } }),
      found: [
        'branding.logo.src: the source is refused: only https: is allowed for an absolute address, and this one uses "http:" [structure]',
      ],
    },
    {
      what: 'a logo outside the assets',
      input: app({ branding: { favicon: { src: 'assets/../secrets.svg' } } }),
      found: [
        'branding.favicon.src: the source is refused: it contains a parent-directory segment (".."), which is not allowed in a relative path however it resolves [structure]',
      ],
    },
    {
      what: 'a logo whose alt is not a text',
      input: app({ branding: { logo: { src: 'assets/logo.svg', alt: 3 } } }),
      found: ['branding.logo.alt: must be a text [structure]'],
    },
  ];
  it.each(rows)('refuses $what', ({ input, found }) => {
    expect(show(validateApp(input))).toEqual(found);
  });

  it('refuses a module twice, and a platform outside the range', () => {
    expect(
      show(validateApp(app({ modules: ['cases', 'cases'] }), { registries: withCases })),
    ).toEqual(['modules[1]: the module "cases" is listed twice [structure]']);
    expect(show(validateApp(app({ platform: '^1.0.0' }), { platformVersion: '0.2.0' }))).toEqual([
      'platform: this platform is 0.2.0, outside "^1.0.0" [unknown]',
    ]);
  });
});

describe('the platform range', () => {
  const holds = (version: string, range: string): boolean => {
    const comparators = parseRange(range);
    const parsed = parseVersion(version);
    if (!comparators || !parsed) throw new Error(`not a version or a range: ${version}, ${range}`);
    return satisfies(parsed, comparators);
  };

  it('reads comparators, carets and tildes, as npm does', () => {
    expect(holds('1.4.0', '>=1.0.0 <2.0.0')).toBe(true);
    expect(holds('2.0.0', '>=1.0.0 <2.0.0')).toBe(false);
    expect(holds('1.9.9', '^1.2.0')).toBe(true);
    expect(holds('2.0.0', '^1.2.0')).toBe(false);
    expect(holds('0.2.5', '^0.2.3')).toBe(true);
    expect(holds('0.3.0', '^0.2.3')).toBe(false);
    expect(holds('0.0.4', '^0.0.3')).toBe(false);
    expect(holds('1.2.9', '~1.2.0')).toBe(true);
    expect(holds('1.3.0', '~1.2.0')).toBe(false);
    expect(holds('1.2.0', '1.2.0')).toBe(true);
  });

  it('puts a prerelease before its release', () => {
    expect(holds('1.0.0-rc.1', '>=1.0.0')).toBe(false);
    expect(holds('1.0.0-rc.2', '>1.0.0-rc.1')).toBe(true);
    expect(holds('1.0.0-rc.10', '>1.0.0-rc.9')).toBe(true);
    expect(holds('1.0.0-alpha', '<1.0.0-alpha.1')).toBe(true);
  });

  it('refuses what is not a range', () => {
    for (const text of ['', ' ', '1.0', 'latest', '>=1.0.0 || <0.1.0', '1.x', '>= 1.0.0', '01.0.0'])
      expect(parseRange(text)).toBeNull();
  });
});

describe('a queue', () => {
  const queue = (keys: Record<string, unknown> = {}): Record<string, unknown> => ({
    version: 2,
    label: 'Open claims',
    pageProvider: 'payers_open_claims',
    columns: ['claim:number'],
    ...keys,
  });

  it("passes a sound one, with the platform's row and bulk actions", () => {
    const sound = queue({
      parameters: ['Claim', 30, true],
      facets: [
        { aggregate: 'claim_type_agg', labelKey: 'payers.facet.type' },
        // An aggregate on a reference, its buckets shown by their records' titles.
        { aggregate: 'claim_member_agg', label: 'Member', widget: 'document-link' },
      ],
      rowActions: ['app.rowActions.download'],
      bulkActions: ['app.bulkActions.downloadZip'],
      visibleWhen: 'app.rules.isAdministrator',
    });
    expect(show(validateQueue(sound))).toEqual([]);
  });

  const rows: readonly Row[] = [
    { what: 'not an object', input: 'x', found: [': a queue file is a JSON object [structure]'] },
    {
      what: 'a parameter from a record it does not have',
      input: queue({ parameters: [{ field: 'claim:member' }] }),
      found: [
        'parameters[0]: a queue has no open record, so a page provider parameter is a literal [structure]',
      ],
    },
    {
      what: 'facets that are not a list',
      input: queue({ facets: {} }),
      found: ['facets: facets must be a list [structure]'],
    },
    {
      what: 'a facet that is not an object',
      input: queue({ facets: ['claim_type_agg'] }),
      found: ['facets[0]: a facet is { "aggregate": <name>, "label" or "labelKey" } [structure]'],
    },
    {
      what: 'a facet with no aggregate',
      input: queue({ facets: [{ aggregate: '1st' }] }),
      found: [
        `facets[0].aggregate: needs the name of one of the page provider's aggregates [structure]`,
      ],
    },
    {
      what: "a facet's buckets through a widget that does not show them",
      input: queue({ facets: [{ aggregate: 'claim_adjuster_agg', widget: 'user' }] }),
      found: [
        'facets[0].widget: a facet shows its buckets as the server returns them, or through "document-link", not "user" [parameter]',
      ],
    },
    {
      what: "a facet's buckets through a widget nobody registered, or no widget's name",
      input: queue({
        facets: [
          { aggregate: 'claim_member_agg', widget: 'record-title' },
          { aggregate: 'claim_type_agg', widget: ['document-link'] },
        ],
      }),
      found: [
        'facets[0].widget: the widget "record-title" is not registered [unknown]',
        'facets[1].widget: a widget is named by its ID [structure]',
      ],
    },
    {
      what: 'a sort on a reference a column shows through show',
      input: queue({
        columns: [
          'claim:number',
          {
            field: 'claim:member',
            widget: 'document-link',
            parameters: { types: ['Member'], show: 'member:plan' },
          },
        ],
        sort: [{ field: 'claim:member', order: 'asc' }],
      }),
      found: [
        `sort[0].field: a column shows claim:member through "show", so the records cannot be sorted by it: they would be ordered by the linked record's stored id [parameter]`,
      ],
    },
    {
      what: 'bulk actions that are not a list',
      input: queue({ bulkActions: 'app.bulkActions.delete' }),
      found: ['bulkActions: bulkActions must be a list [structure]'],
    },
    {
      what: 'a bulk action nobody registered',
      input: queue({ bulkActions: ['app.bulkActions.print'] }),
      found: [
        'bulkActions[0]: the bulk action "app.bulkActions.print" is not registered [unknown]',
      ],
    },
    {
      what: "a task's variable as a column",
      input: queue({ columns: ['var:decision'] }),
      found: ['columns[0]: "var:" names a task variable, which only a task form has [structure]'],
    },
    {
      what: 'a search that is not an object, or names nothing for the person',
      input: queue({ search: 'barcode' }),
      found: [
        'search: a search is { "label" or "labelKey", and "open": "single" or none } [structure]',
      ],
    },
    {
      what: 'a search with no name',
      input: queue({ search: { open: 'single' } }),
      found: ['search: needs a "label" or a "labelKey" [structure]'],
    },
    {
      what: 'a search that opens what it cannot',
      input: queue({ search: { label: 'Barcode', open: 'first', camera: true } }),
      found: [
        'search.camera: "camera" is not a key version 2 has [unknown]',
        'search.open: a search opens "single": the one record it finds alone [structure]',
      ],
    },
  ];
  it.each(rows)('refuses $what', ({ input, found }) => {
    expect(show(validateQueue(input))).toEqual(found);
  });

  it('passes a search, its text the page provider’s last parameter', () => {
    expect(
      show(
        validateQueue(queue({ search: { labelKey: 'records.lookup.barcode', open: 'single' } })),
      ),
    ).toEqual([]);
    expect(show(validateQueue(queue({ search: { label: 'Barcode' } })))).toEqual([]);
  });
});

describe('actions.json', () => {
  const operations = new Set(['Payers.RequestRecords']);
  const actions = (...list: unknown[]) => ({ version: 2, actions: list });
  const approve = (keys: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 'payers.approve',
    label: 'Approve',
    transition: 'approve',
    ...keys,
  });
  const request = (keys: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 'payers.request',
    label: 'Request records',
    operation: 'Payers.RequestRecords',
    ...keys,
  });

  it('passes a lifecycle button and an operation on the allow-list, with fields as parameters', () => {
    const sound = actions(
      approve({ icon: 'check', order: 10, on: ['record', 'row'], refresh: false }),
      request({
        parameters: { provider: { field: 'claim:provider' }, urgent: true },
        confirm: { labelKey: 'payers.request.confirm' },
        success: { label: 'Requested' },
      }),
    );
    expect(show(validateActions(sound, { operations }))).toEqual([]);
  });

  const withForm = (keys: Record<string, unknown> = {}): Record<string, unknown> =>
    request({
      enabledWhen: 'app.rules.canWrite',
      parameters: { provider: { field: 'claim:provider' }, note: { field: 'var:note' } },
      form: [
        {
          field: 'var:note',
          widget: 'long-text',
          parameters: { rows: 3 },
          required: true,
          labelKey: 'payers.request.note',
        },
      ],
      ...keys,
    });

  it('passes an operation with an enabled rule and a form whose fields its parameters send', () => {
    expect(show(validateActions(actions(withForm()), { operations }))).toEqual([]);
    // A field written as a name alone, as a task form may.
    expect(
      show(
        validateActions(
          actions(withForm({ form: ['var:note'], parameters: { note: { field: 'var:note' } } })),
          { operations },
        ),
      ),
    ).toEqual([]);
  });

  const rows: readonly Row[] = [
    {
      what: 'an enabled rule nobody registered',
      input: actions(withForm({ enabledWhen: 'acme.rules.unknown' })),
      found: ['actions[0].enabledWhen: the rule "acme.rules.unknown" is not registered [unknown]'],
    },
    {
      what: 'a form that is not a list of fields',
      input: actions(withForm({ form: {} })),
      found: [
        'actions[0].form: a form is a list of the fields it asks for [structure]',
        `actions[0].parameters.note.field: "var:note" is a field of the action's form, and its form has no such field [structure]`,
      ],
    },
    {
      what: "a form field that is the record's, not a value to enter",
      input: actions(
        withForm({ form: ['claim:number'], parameters: { provider: { field: 'claim:provider' } } }),
      ),
      found: [
        `actions[0].form[0]: an action's form asks for values: each field is "var:<name>", a letter then letters, digits or "_" [structure]`,
      ],
    },
    {
      what: 'a form field no parameter sends',
      input: actions(withForm({ parameters: { provider: { field: 'claim:provider' } } })),
      found: [
        'actions[0].form[0].field: no parameter sends "var:note": give one { "field": "var:note" } [structure]',
      ],
    },
    {
      what: 'a parameter sending a form field the form does not have',
      input: actions(
        withForm({
          parameters: { note: { field: 'var:note' }, urgent: { field: 'var:urgent' } },
        }),
      ),
      found: [
        `actions[0].parameters.urgent.field: "var:urgent" is a field of the action's form, and its form has no such field [structure]`,
      ],
    },
    {
      what: 'a form field the form engine refuses',
      input: actions(withForm({ form: [{ field: 'var:note', widget: 'signature' }] })),
      found: ['actions[0].form[0].widget: the widget "signature" is not registered [unknown]'],
    },
    {
      what: 'a form on a bulk action',
      input: actions(
        withForm({ on: ['row', 'bulk'], parameters: { note: 'fixed' }, form: ['var:note'] }),
      ),
      found: [
        'actions[0].form: a bulk action runs on many records at once, so it has no form [structure]',
        'actions[0].form[0].field: no parameter sends "var:note": give one { "field": "var:note" } [structure]',
      ],
    },
    {
      what: 'a form on a lifecycle button',
      input: actions(approve({ form: ['var:note'] })),
      found: [
        'actions[0].form: a form gives values to an operation [structure]',
        'actions[0].form[0].field: no parameter sends "var:note": give one { "field": "var:note" } [structure]',
      ],
    },
    {
      what: 'a parameter worked out by a computation, which the server does not run',
      input: actions(
        request({
          parameters: {
            reference: { computed: { type: 'core.template', parameters: ['{claim:number}'] } },
          },
        }),
      ),
      found: [
        'actions[0].parameters.reference: a computation is worked out in the browser, which the server does not trust: a parameter is a literal, a field of the record or a field of the form [structure]',
      ],
    },
    {
      what: 'not an object',
      input: null,
      found: [': an actions file is a JSON object [structure]'],
    },
    {
      what: 'actions that are not a list',
      input: { version: 2, actions: {} },
      found: ['actions: actions must be a list [structure]'],
    },
    {
      what: 'an action that is not an object',
      input: actions('payers.approve'),
      found: ['actions[0]: an action is an object [structure]'],
    },
    {
      what: "an id that is the platform's",
      input: actions(approve({ id: 'app.toolbar.approve' })),
      found: [
        'actions[0].id: the id "app.toolbar.approve" belongs to the platform: actions.json adds actions of its own [structure]',
      ],
    },
    {
      what: 'an id used twice',
      input: actions(approve(), approve()),
      found: [
        'actions[1].id: the id "payers.approve" is already used at actions[0].id [structure]',
      ],
    },
    {
      what: 'an icon that is not a name',
      input: actions(approve({ icon: 'Check Mark' })),
      found: [
        'actions[0].icon: icon is the name of a Material Symbols icon, such as "check" [structure]',
      ],
    },
    {
      what: 'an order that is not a whole number',
      input: actions(approve({ order: 1.5 })),
      found: ['actions[0].order: order is a whole number [structure]'],
    },
    {
      what: 'neither a transition nor an operation',
      input: actions({ id: 'payers.nothing', label: 'Nothing' }),
      found: ['actions[0]: an action has "transition" or "operation", one of the two [structure]'],
    },
    {
      what: 'a transition that is not a name',
      input: actions(approve({ transition: '' })),
      found: [
        'actions[0].transition: transition is the name of a lifecycle transition [structure]',
      ],
    },
    {
      what: 'an operation that is not an id',
      input: actions(request({ operation: 3 })),
      found: [
        'actions[0].operation: operation is the ID of an Automation operation or chain [structure]',
      ],
    },
    {
      what: 'an operation nobody allowed',
      input: actions(request({ operation: 'Document.Delete' })),
      found: [
        `actions[0].operation: the operation "Document.Delete" is not on this deployment's allow-list [unknown]`,
      ],
    },
    {
      what: 'parameters for a transition, which takes none',
      input: actions(approve({ parameters: { comment: 'ok' } })),
      found: ['actions[0].parameters: parameters belong to an operation [structure]'],
    },
    {
      what: 'parameters that are not an object',
      input: actions(request({ parameters: ['urgent'] })),
      found: ['actions[0].parameters: parameters must be an object [structure]'],
    },
    {
      what: 'a parameter name with a hyphen',
      input: actions(request({ parameters: { 'due-date': '2026-12-01' } })),
      found: ['actions[0].parameters.due-date: "due-date" is not a parameter name [structure]'],
    },
    {
      what: "a bulk action given one record's field",
      input: actions(
        request({ on: ['bulk'], parameters: { provider: { field: 'claim:provider' } } }),
      ),
      found: [
        'actions[0].parameters.provider: a bulk action runs on many records at once, so its parameters are literals [structure]',
      ],
    },
    {
      what: 'no place to show',
      input: actions(approve({ on: [] })),
      found: ['actions[0].on: on lists where it shows: "record", "row" or "bulk" [structure]'],
    },
    {
      what: 'a place there is not',
      input: actions(approve({ on: ['toolbar'] })),
      found: ['actions[0].on[0]: "toolbar" is not "record", "row" or "bulk" [structure]'],
    },
    {
      what: 'a place twice',
      input: actions(approve({ on: ['row', 'row'] })),
      found: ['actions[0].on[1]: "row" is listed twice [structure]'],
    },
    {
      what: 'a confirmation that is not a message',
      input: actions(approve({ confirm: 'Sure?' })),
      found: ['actions[0].confirm: a message is { "label" } or { "labelKey" } [structure]'],
    },
    {
      what: 'a success message with no text',
      input: actions(approve({ success: {} })),
      found: ['actions[0].success: needs a "label" or a "labelKey" [structure]'],
    },
    {
      what: 'a refresh that is not true or false',
      input: actions(approve({ refresh: 'yes' })),
      found: ['actions[0].refresh: refresh is true or false [structure]'],
    },
  ];
  it.each(rows)('refuses $what', ({ input, found }) => {
    expect(show(validateActions(input, { operations }))).toEqual(found);
  });

  it('refuses every operation when it has no allow-list', () => {
    expect(show(validateActions(actions(request())))).toEqual([
      `actions[0].operation: the operation "Payers.RequestRecords" is not on this deployment's allow-list [unknown]`,
    ]);
  });
});

describe('a task form', () => {
  const form = (...fields: unknown[]) => ({ version: 2, cards: [{ id: 'c', fields }] });

  it("edits the step's var: fields, and shows the record's own properties", () => {
    const sound = form('claim:number', {
      field: 'var:comment',
      widget: 'long-text',
      required: { type: 'app.rules.fieldIn', parameters: [{ field: 'var:decision' }, 'deny'] },
      checks: [{ type: 'core.atMost', parameters: [{ field: 'claim:billedAmount' }] }],
    });
    expect(show(validateTaskForm(sound))).toEqual([]);
  });

  const rows: readonly Row[] = [
    {
      what: 'not an object',
      input: 2,
      found: [': a task form is a JSON object [structure]'],
    },
    {
      what: "a form key on the record's own property",
      input: form({ field: 'claim:allowedAmount', required: true }),
      found: [
        `cards[0].fields[0].required: "required" belongs on a var: field: a task form shows the record's own properties read-only [structure]`,
      ],
    },
    {
      what: 'a key only view mode has',
      input: { ...form('var:comment'), columns: 2 },
      found: ['columns: columns belongs in view mode only [structure]'],
    },
  ];
  it.each(rows)('refuses $what', ({ input, found }) => {
    expect(show(validateTaskForm(input))).toEqual(found);
  });

  it('is the only file where var: means something', () => {
    expect(show(validateLayoutV2(form('var:comment'), { mode: 'edit' }))).toEqual([
      'cards[0].fields[0]: "var:" names a task variable, which only a task form has [structure]',
    ]);
    const rule = { type: 'app.rules.fieldIn', parameters: [{ field: 'var:decision' }, 'deny'] };
    expect(
      show(validateLayoutV2(form({ field: 'claim:reason', visibleWhen: rule }), { mode: 'view' })),
    ).toEqual([
      'cards[0].fields[0].visibleWhen.parameters[0].field: "var:" names a task variable, which only a task form has [structure]',
    ]);
  });
});

describe('a labels file', () => {
  it('passes keys with their texts, the platform’s keys among them', () => {
    const sound = {
      version: 2,
      labels: { 'payers.app.claims': 'Claims', 'layout.field.claim:memberId': 'Member ID' },
    };
    expect(show(validateLabels(sound))).toEqual([]);
  });

  const rows: readonly Row[] = [
    { what: 'not an object', input: 'en', found: [': a labels file is a JSON object [structure]'] },
    {
      what: 'labels that are not a map',
      input: { version: 2, labels: [] },
      found: ['labels: labels maps each key to its text [structure]'],
    },
    {
      what: 'a key with a space',
      input: { version: 2, labels: { 'payers app': 'Claims' } },
      found: [
        'labels["payers app"]: a label key is letters, digits, ".", "_", ":" and "-", starting with a letter or digit [structure]',
      ],
    },
    {
      what: 'an empty text',
      input: { version: 2, labels: { 'payers.app': '' } },
      found: ['labels["payers.app"]: must be a text [structure]'],
    },
  ];
  it.each(rows)('refuses $what', ({ input, found }) => {
    expect(show(validateLabels(input))).toEqual(found);
  });
});

describe("a module's settings", () => {
  it('passes an object of settings for a registered module', () => {
    const sound = { version: 2, settings: { checklist: 'x' } };
    expect(show(validateModuleSettings(sound, { module: 'cases', registries: withCases }))).toEqual(
      [],
    );
  });

  it('refuses a file that is not an object, settings that are not one, and a module there is not', () => {
    expect(show(validateModuleSettings([], { module: 'cases', registries: withCases }))).toEqual([
      ': a module settings file is a JSON object [structure]',
    ]);
    expect(
      show(
        validateModuleSettings(
          { version: 2, settings: 'on' },
          { module: 'cases', registries: withCases },
        ),
      ),
    ).toEqual(['settings: settings must be an object [structure]']);
    expect(show(validateModuleSettings({ version: 2, settings: {} }, { module: 'cases' }))).toEqual(
      [': the module "cases" is not registered [unknown]'],
    );
  });
});

// The guards an independent review found could be taken out with every test still passing, and
// the refusals added since: each has its control here.

describe("a branding image's source, held to version 1's rules", () => {
  const branded = (src: unknown) => ({
    version: 2,
    id: 'claims',
    label: 'Claims',
    packageVersion: '1.0.0',
    platform: '^0.2.0',
    groups: ['members'],
    branding: { logo: { src } },
  });
  const refused = (reason: string) => [
    `branding.logo.src: the source is refused: ${reason} [structure]`,
  ];

  it('accepts what version 1 accepts, in assets/', () => {
    for (const src of [
      'assets/logo.svg',
      'assets/logo.svg?v=2',
      'https://cdn.example.com/logo.svg',
      'HTTPS://cdn.example.com/logo.svg',
      'data:image/png;base64,iVBORw0KGgo=',
    ])
      expect(show(validateApp(branded(src)))).toEqual([]);
  });

  const rows: readonly { src: unknown; reason: string }[] = [
    { src: 3, reason: 'it is not a text' },
    { src: ' ', reason: 'it is blank, so it names no file' },
    {
      src: 'assets/%2e%2e/%2e%2e/api/v1/me',
      reason:
        'it contains a parent-directory segment (".."), which is not allowed in a relative path however it resolves',
    },
    {
      src: 'assets/\t../logo.svg',
      reason:
        'it contains a control character, which the URL parser drops, so the value is not what it looks like',
    },
    {
      src: 'assets\\logo.svg',
      reason: 'it contains a backslash, which the URL parser rewrites as a path separator',
    },
    {
      src: 'data:image/png;base64,',
      reason: 'it is a data: URI that is not an image, or that carries no payload',
    },
    { src: 'https:///logo.svg', reason: 'an absolute https: address must name a host' },
    { src: 'https://exa mple.com/logo.svg', reason: 'it is not a valid URL' },
    {
      src: '/assets/logo.svg',
      reason: 'an absolute path is not allowed; use a path relative to the configuration directory',
    },
    { src: '?v=2', reason: 'it has no path, so it would load bootstrap.json itself' },
    {
      src: 'images/logo.svg',
      reason: 'it is a relative path outside assets/, where a package keeps its images',
    },
  ];
  it.each(rows)('refuses $src', ({ src, reason }) => {
    expect(show(validateApp(branded(src)))).toEqual(refused(reason));
  });
});

describe('app.json, further', () => {
  const app = (keys: Record<string, unknown> = {}) => ({
    version: 2,
    id: 'claims',
    label: 'Claims',
    packageVersion: '1.0.0',
    platform: '^0.2.0',
    groups: ['members'],
    ...keys,
  });

  it('takes $schema, for editors, and build metadata in its version', () => {
    const editor = app({ $schema: './app.schema.json', packageVersion: '1.0.0+build.5' });
    expect(show(validateApp(editor))).toEqual([]);
  });

  it('refuses a $schema that is not a text, a key it does not have, and an empty tab title', () => {
    expect(show(validateApp(app({ $schema: 2 })))).toEqual([
      '$schema: $schema is the address of a JSON Schema, for editors [structure]',
    ]);
    expect(show(validateApp(app({ extra: true })))).toEqual([
      'extra: "extra" is not a key version 2 has [unknown]',
    ]);
    expect(show(validateApp(app({ branding: { documentTitle: '' } })))).toEqual([
      'branding.documentTitle: must be a text [structure]',
    ]);
  });
});

describe('the platform range, as npm reads it', () => {
  const holds = (version: string, range: string): boolean =>
    satisfies(parseVersion(version)!, parseRange(range)!); // eslint-disable-line @typescript-eslint/no-non-null-assertion

  it("leaves out the next version's prereleases, and any prerelease no comparator names", () => {
    expect(holds('2.0.0-rc.1', '^1.2.0')).toBe(false);
    expect(holds('1.3.0-beta.1', '~1.2.0')).toBe(false);
    expect(holds('1.0.0-beta.1', '>=0.3.0 <1.0.0')).toBe(false);
    expect(holds('1.2.0-rc.1', '^1.2.0')).toBe(false);
    expect(holds('1.2.0-rc.2', '>=1.2.0-rc.1 <2.0.0')).toBe(true);
  });

  it('ranks a release after its own prereleases, inside one range', () => {
    expect(holds('1.0.0', '>1.0.0-rc.1')).toBe(true);
    expect(holds('1.0.0-rc.2', '>=1.0.0-rc.1 <1.0.0')).toBe(true);
    expect(holds('1.0.0', '>=1.0.0-rc.1 <1.0.0')).toBe(false);
  });

  it('ignores build metadata', () => {
    expect(holds('1.2.0+build.5', '1.2.0')).toBe(true);
    expect(parseVersion('1.0.0+build.5')).not.toBeNull();
  });
});

describe('a queue, further', () => {
  const queue = (keys: Record<string, unknown> = {}): Record<string, unknown> => ({
    version: 2,
    label: 'Open claims',
    pageProvider: 'payers_open_claims',
    columns: ['claim:number'],
    ...keys,
  });
  const without = (key: string): Record<string, unknown> => {
    const content = queue();
    delete content[key];
    return content;
  };

  const rows: readonly Row[] = [
    {
      what: 'no name',
      input: without('label'),
      found: [': needs a "label" or a "labelKey" [structure]'],
    },
    {
      what: 'a rule nobody registered for who sees it',
      input: queue({ visibleWhen: 'app.rules.nope' }),
      found: ['visibleWhen: the rule "app.rules.nope" is not registered [unknown]'],
    },
    {
      what: 'a rule that is not an id',
      input: queue({ visibleWhen: '' }),
      found: ['visibleWhen: a rule is an ID, or { "type": <ID>, "parameters": [...] } [structure]'],
    },
    {
      what: 'parameters that are null',
      input: queue({ parameters: null }),
      found: ['parameters: parameters must be a list [structure]'],
    },
    {
      what: "a task's variable to sort by",
      input: queue({ sort: [{ field: 'var:decision' }] }),
      found: [
        'sort[0].field: "var:" names a task variable, which only a task form has [structure]',
      ],
    },
    {
      what: "a task's variable in a widget's parameter",
      input: queue({
        columns: [
          {
            field: 'claim:amount',
            widget: 'currency',
            parameters: { currency: { field: 'var:cur' } },
          },
        ],
      }),
      found: [
        'columns[0].parameters.currency.field: "var:" names a task variable, which only a task form has [structure]',
      ],
    },
  ];
  it.each(rows)('refuses $what', ({ input, found }) => {
    expect(show(validateQueue(input))).toEqual(found);
  });
});

describe('actions.json, further', () => {
  const operations = new Set(['Payers.RequestRecords']);
  const approve = (keys: Record<string, unknown> = {}) => ({
    id: 'payers.approve',
    label: 'Approve',
    transition: 'approve',
    ...keys,
  });

  const rows: readonly Row[] = [
    {
      what: 'a transition and an operation together',
      input: { version: 2, actions: [approve({ operation: 'Payers.RequestRecords' })] },
      found: ['actions[0]: an action has "transition" or "operation", one of the two [structure]'],
    },
    {
      what: 'an action with no name',
      input: { version: 2, actions: [{ id: 'payers.approve', transition: 'approve' }] },
      found: ['actions[0]: needs a "label" or a "labelKey" [structure]'],
    },
    {
      what: 'a key an action does not have',
      input: { version: 2, actions: [approve({ colour: 'green' })] },
      found: ['actions[0].colour: "colour" is not a key version 2 has [unknown]'],
    },
    {
      what: 'a key the file does not have',
      input: { version: 2, actions: [], extra: true },
      found: ['extra: "extra" is not a key version 2 has [unknown]'],
    },
    {
      what: 'a rule nobody registered for when it shows',
      input: { version: 2, actions: [approve({ visibleWhen: 'app.rules.nope' })] },
      found: ['actions[0].visibleWhen: the rule "app.rules.nope" is not registered [unknown]'],
    },
    {
      // Before the server built the parameters, a template here was refused for its var: alone;
      // every computed parameter is refused now, the server running no computation.
      what: "a task's variable in a template parameter",
      input: {
        version: 2,
        actions: [
          {
            id: 'payers.request',
            label: 'Request',
            operation: 'Payers.RequestRecords',
            parameters: {
              note: { computed: { type: 'core.template', parameters: ['{var:secret}'] } },
            },
          },
        ],
      },
      found: [
        'actions[0].parameters.note: a computation is worked out in the browser, which the server does not trust: a parameter is a literal, a field of the record or a field of the form [structure]',
      ],
    },
  ];
  it.each(rows)('refuses $what', ({ input, found }) => {
    expect(show(validateActions(input, { operations }))).toEqual(found);
  });

  it('refuses an id registered in Layer 2 code, which a manifest cannot rebind either', () => {
    const registries = withRegistered(PACKAGED_REGISTRIES, {
      rowActions: ['acme.rowActions.sign'],
      bulkActions: ['acme.bulkActions.archive'],
      actions: ['acme.toolbar.countersign'],
    });
    const file = {
      version: 2,
      actions: [
        { id: 'acme.rowActions.sign', label: 'Sign', on: ['row'], transition: 'sign' },
        { id: 'acme.bulkActions.archive', label: 'Archive', on: ['bulk'], transition: 'archive' },
        { id: 'acme.toolbar.countersign', label: 'Countersign', transition: 'countersign' },
      ],
    };
    expect(show(validateActions(file, { registries }))).toEqual([
      'actions[0].id: the id "acme.rowActions.sign" is registered in code, and a manifest cannot rebind it [structure]',
      'actions[1].id: the id "acme.bulkActions.archive" is registered in code, and a manifest cannot rebind it [structure]',
      'actions[2].id: the id "acme.toolbar.countersign" is registered in code, and a manifest cannot rebind it [structure]',
    ]);
  });
});

describe('var: outside a task form, further', () => {
  it('is refused in a template placeholder and in a related list, and taken in a task form', () => {
    const template = {
      version: 2,
      cards: [
        {
          id: 'c',
          fields: [
            { id: 'x', computed: { type: 'core.template', parameters: ['{var:decision}'] } },
          ],
        },
      ],
    };
    expect(show(validateLayoutV2(template, { mode: 'view' }))).toEqual([
      'cards[0].fields[0].computed.parameters[0]: "var:" names a task variable, which only a task form has [structure]',
    ]);
    expect(show(validateTaskForm(template))).toEqual([]);
    const related = {
      version: 2,
      cards: [
        {
          id: 'r',
          related: {
            pageProvider: 'p',
            parameters: [{ field: 'var:decision' }],
            columns: ['dc:title'],
          },
        },
      ],
    };
    expect(show(validateLayoutV2(related, { mode: 'view' }))).toEqual([
      'cards[0].related.parameters[0].field: "var:" names a task variable, which only a task form has [structure]',
    ]);
  });
});

describe('null parameters, which the schemas refuse too', () => {
  it('are refused in a rule and in a computation', () => {
    const file = {
      version: 2,
      cards: [
        {
          id: 'c',
          fields: [
            { field: 'a:b', visibleWhen: { type: 'app.rules.isType', parameters: null } },
            { id: 'n', computed: { type: 'core.count', parameters: null } },
          ],
        },
      ],
    };
    expect(show(validateLayoutV2(file, { mode: 'view' }))).toEqual([
      'cards[0].fields[0].visibleWhen.parameters: parameters must be a list [structure]',
      'cards[0].fields[1].computed.parameters: parameters must be a list [structure]',
    ]);
  });
});

describe('labels and module settings, further', () => {
  it('refuse a key the file does not have', () => {
    expect(show(validateLabels({ version: 2, labels: {}, extra: 1 }))).toEqual([
      'extra: "extra" is not a key version 2 has [unknown]',
    ]);
    expect(
      show(
        validateModuleSettings(
          { version: 2, settings: {}, extra: 1 },
          { module: 'cases', registries: withCases },
        ),
      ),
    ).toEqual(['extra: "extra" is not a key version 2 has [unknown]']);
  });
});

describe("each widget's parameters", () => {
  const widget = (entry: Record<string, unknown>) =>
    show(validateLayoutV2({ version: 2, cards: [{ id: 'c', fields: [entry] }] }, { mode: 'view' }));
  const rows: readonly { what: string; entry: Record<string, unknown>; found: string }[] = [
    {
      what: 'rows out of range',
      entry: { field: 'a:b', widget: 'long-text', parameters: { rows: 1 } },
      found: 'rows: rows must be a whole number from 2 to 20',
    },
    {
      what: 'decimals out of range',
      entry: { field: 'a:b', widget: 'number', parameters: { decimals: 11 } },
      found: 'decimals: decimals must be a whole number from 0 to 10',
    },
    {
      what: 'a scale that is neither',
      entry: { field: 'a:b', widget: 'percent', parameters: { scale: 50 } },
      found: 'scale: scale must be one of 1, 100',
    },
    {
      what: 'a date format it does not have',
      entry: { field: 'a:b', widget: 'date', parameters: { format: 'iso' } },
      found: 'format: format must be one of "short", "long"',
    },
    {
      what: 'a blank directory',
      entry: { field: 'a:b', widget: 'vocabulary', parameters: { directory: ' ' } },
      found: 'directory: directory must be a text',
    },
    {
      what: 'no types',
      entry: { field: 'a:b', widget: 'document-link', parameters: { types: [] } },
      found: 'types: types must be a list of texts',
    },
    {
      what: 'an empty type',
      entry: { field: 'a:b', widget: 'document-link', parameters: { types: ['Claim', ''] } },
      found: 'types: types must be a list of texts',
    },
    {
      what: 'types that are not a list',
      entry: { field: 'a:b', widget: 'document-link', parameters: { types: 'Claim' } },
      found: 'types: types must be a list of texts',
    },
    {
      what: 'parts that are not a map',
      entry: { field: 'a:b', widget: 'address', parameters: { parts: 'street' } },
      found: 'parts: parts must map street, city, postcode, country to subfield names',
    },
    {
      what: 'a part it does not know',
      entry: { field: 'a:b', widget: 'address', parameters: { parts: { planet: 'p' } } },
      found: 'parts: parts has parts it does not know: planet',
    },
    {
      what: 'a part with no subfield',
      entry: { field: 'a:b', widget: 'address', parameters: { parts: { street: '' } } },
      found: 'parts: parts must give each part a subfield name',
    },
    {
      what: 'no tones',
      entry: { field: 'a:b', widget: 'status-badge', parameters: { tones: {} } },
      found: 'tones: tones must map each value to a tone',
    },
    {
      what: 'a tone it does not have',
      entry: { field: 'a:b', widget: 'status-badge', parameters: { tones: { open: 'green' } } },
      found:
        'tones: tones gives open a tone that is not one of positive, warning, negative, info, neutral',
    },
    {
      what: 'no columns',
      entry: { field: 'a:b', widget: 'table', parameters: { columns: [] } },
      found: 'columns: columns must be a list of field entries',
    },
  ];
  it.each(rows)('refuses $what', ({ entry, found }) => {
    expect(widget(entry)).toEqual([`cards[0].fields[0].parameters.${found} [parameter]`]);
  });
});

// What a second review found, on the pull request that added the package pipeline.
describe('the second review', () => {
  const holds = (version: string, range: string): boolean =>
    satisfies(parseVersion(version)!, parseRange(range)!); // eslint-disable-line @typescript-eslint/no-non-null-assertion

  it("keeps the next version's prereleases out of ^ and ~ when another comparator names one", () => {
    expect(holds('2.0.0-beta.1', '^1.2.0 >=2.0.0-beta.1')).toBe(false);
    expect(holds('1.3.0-beta.1', '~1.2.0 >=1.3.0-beta.1')).toBe(false);
    expect(holds('1.5.0-beta.1', '^1.2.0 >=1.5.0-beta.1')).toBe(true);
  });

  it('refuses a numeric prerelease identifier with a leading zero', () => {
    expect(parseVersion('1.0.0-01')).toBeNull();
    expect(parseVersion('1.0.0-rc.01')).toBeNull();
    expect(parseRange('>=1.0.0-01')).toBeNull();
    expect(parseVersion('1.0.0-0')).not.toBeNull();
    expect(parseVersion('1.0.0-0a')).not.toBeNull();
  });

  it('cannot loosen a rule the platform already knows by registering it again', () => {
    const registries = withRegistered(PACKAGED_REGISTRIES, {
      rules: ['app.rules.isType', 'acme.rules.isContract'],
    });
    expect(registries.rules['app.rules.isType']).toEqual(
      PACKAGED_REGISTRIES.rules['app.rules.isType'],
    );
    expect(registries.rules['acme.rules.isContract']).toBeNull();
    const file = {
      version: 2,
      cards: [
        {
          id: 'c',
          fields: [{ field: 'a:b', visibleWhen: { type: 'app.rules.isType', parameters: [] } }],
        },
      ],
    };
    expect(show(validateLayoutV2(file, { mode: 'view', registries }))).toEqual([
      'cards[0].fields[0].visibleWhen.parameters: the rule "app.rules.isType" takes at least 1 parameter, not 0 [parameter]',
    ]);
  });

  it('refuses a misspelt key in a sort, which would lose its order', () => {
    const queue = {
      version: 2,
      label: 'Open claims',
      pageProvider: 'payers_open_claims',
      columns: ['claim:number'],
      sort: [{ field: 'claim:received', oder: 'desc' }],
    };
    expect(show(validateQueue(queue))).toEqual([
      'sort[0].oder: "oder" is not a key version 2 has [unknown]',
    ]);
  });
});

describe('numbers past JavaScript safe integers', () => {
  const version = (text: string) => parseVersion(text)!; // eslint-disable-line @typescript-eslint/no-non-null-assertion

  it('compares two numeric prerelease identifiers exactly, one way and the other', () => {
    const [older, newer] = ['1.0.0-9007199254740992', '1.0.0-9007199254740993'];
    expect(compareVersions(version(older), version(newer))).toBe(-1);
    expect(compareVersions(version(newer), version(older))).toBe(1);
    expect(satisfies(version(older), parseRange(`>${newer}`)!)).toBe(false); // eslint-disable-line @typescript-eslint/no-non-null-assertion
    expect(satisfies(version(newer), parseRange(`>${older}`)!)).toBe(true); // eslint-disable-line @typescript-eslint/no-non-null-assertion
    expect(compareVersions(version('1.0.0-10'), version('1.0.0-9'))).toBe(1);
  });

  it('refuses a major, minor or patch it cannot hold exactly, as npm does', () => {
    expect(parseVersion('9007199254740991.0.0')).not.toBeNull();
    for (const text of ['9007199254740992.0.0', '1.9007199254740993.0', '1.0.99999999999999999999'])
      expect(parseVersion(text)).toBeNull();
  });
});
