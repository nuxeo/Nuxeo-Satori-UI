import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { readContentModel, type ContentModel } from '@agentic-ui/shared/app-definition';
import { QueuePageComponent } from '@agentic-ui/shared/queues';
import { NxsConfirmDialogComponent, provideNxsComponents } from '@nuxeo/satori-platform/components';
import { BehaviorSubject, Subject, firstValueFrom, of, startWith } from 'rxjs';

import { controlContract } from '../control-contract.testing';
import { LayoutDesignerService, type Reading } from '../layout-designer.service';
import type { LayoutJson } from '../layout-edits';
import { QueueDesignerPageComponent } from './queue-designer-page';
import { LayerPanelComponent } from '../layer/layer-panel';

/**
 * The deployment layer's panel, as the page hands it the file open: what it is given is what is
 * checked here. The panel itself, and every request it makes, is held by `layer-panel.spec.ts`.
 */
@Component({
  selector: 'lib-layer-panel',
  standalone: true,
  template: '<p class="stub-layer-panel">{{ path() }}</p>',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class StubLayerPanelComponent {
  readonly path = input<string | null>(null);
  readonly file = input<unknown>(null);
  readonly saveable = input(false);
  readonly openVersion = output<unknown>();
}

/** The queue page, as the designer hands it a preview: what it is given is what is checked. */
@Component({
  selector: 'lib-queue-page',
  standalone: true,
  template: '<p class="stub-queue-page">{{ id() }}</p>',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class StubQueuePageComponent {
  readonly id = input('');
  readonly content = input<unknown>(undefined);
  readonly readOnly = input(false);
}

/** The Contracts kit's renewals queue, cut down, with a facet. */
const RENEWALS: LayoutJson = {
  version: 2,
  labelKey: 'contracts.queue.up-for-renewal',
  pageProvider: 'contracts_up_for_renewal',
  columns: [
    'contract:number',
    { field: 'dc:title', labelKey: 'contracts.field.title' },
    { field: 'contract:end', widget: 'relative-date' },
  ],
  sort: [{ field: 'contract:end', order: 'asc' }],
  facets: [{ aggregate: 'contract_status', label: 'Status' }],
  pageSize: 50,
};

const MODEL: ContentModel = (() => {
  const read = readContentModel({
    doctypes: { Contract: { parent: 'Document', facets: [], schemas: ['dublincore', 'contract'] } },
    facets: [],
    schemas: [
      { name: 'dublincore', '@prefix': 'dc', fields: { title: 'string' } },
      {
        name: 'contract',
        '@prefix': 'contract',
        fields: { number: 'string', end: 'date', owner: 'string' },
      },
    ],
  });
  if (!read.model) throw new Error(read.problems.join('; '));
  return read.model;
})();

describe('QueueDesignerPageComponent', () => {
  let fixture: ComponentFixture<QueueDesignerPageComponent>;
  let page: QueueDesignerPageComponent;
  let source: Subject<Reading<unknown>>;
  let actions: BehaviorSubject<Reading<unknown>>;
  let opened: string[];
  let created: Blob[];
  let clicked: { download: string }[];
  let asked: unknown[];
  let answer: true | undefined;

  beforeEach(() => {
    source = new Subject();
    actions = new BehaviorSubject<Reading<unknown>>({ state: 'read', value: null });
    opened = [];
    created = [];
    clicked = [];
    asked = [];
    answer = undefined;
    URL.createObjectURL = vi.fn((blob: Blob) => {
      created.push(blob);
      return 'blob:queue';
    });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push({ download: this.download });
    });
    TestBed.configureTestingModule({
      imports: [QueueDesignerPageComponent],
      providers: [
        provideRouter([]),
        provideNxsComponents(),
        {
          provide: LayoutDesignerService,
          useValue: {
            queueIds: () => of({ state: 'read', value: ['up-for-renewal', 'terminated'] }),
            queueSource: (id: string) => {
              opened.push(id);
              return source.pipe(startWith({ state: 'reading' } as const));
            },
            model: () => new BehaviorSubject({ state: 'read', value: MODEL }),
            queueRegistered: () => ({ rules: [], rowActions: [], bulkActions: [] }),
            packageActions: () => actions,
          },
        },
        {
          provide: MatDialog,
          useValue: {
            open: (component: unknown, config: { data: unknown }) => {
              asked.push({ component, data: config.data });
              return { afterClosed: () => of(answer) };
            },
          },
        },
      ],
    });
    TestBed.overrideComponent(QueueDesignerPageComponent, {
      remove: { imports: [QueuePageComponent, LayerPanelComponent] },
      add: { imports: [StubQueuePageComponent, StubLayerPanelComponent] },
    });
    fixture = TestBed.createComponent(QueueDesignerPageComponent);
    page = fixture.componentInstance;
  });

  afterEach(() => vi.restoreAllMocks());

  const root = (): HTMLElement => fixture.nativeElement as HTMLElement;

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function open(content: unknown = RENEWALS, id = 'up-for-renewal'): Promise<void> {
    await settle();
    page.idChosen.set(id);
    page.open(id);
    await settle();
    source.next({ state: 'read', value: content });
    await settle();
  }

  /** The native button of the `nxs-` button `selector` names. */
  const button = (selector: string): HTMLButtonElement => {
    const found = root().querySelector<HTMLButtonElement>(`${selector} button`);
    if (!found) throw new Error(`no ${selector}`);
    return found;
  };

  const columns = (): (string | undefined)[] =>
    [...root().querySelectorAll<HTMLElement>('[data-column]')].map(
      (column) => column.dataset['column'],
    );

  const stub = (): StubQueuePageComponent | undefined =>
    fixture.debugElement.query((node) => node.componentInstance instanceof StubQueuePageComponent)
      ?.componentInstance as StubQueuePageComponent | undefined;

  const blobText = (blob: Blob): Promise<string> =>
    new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(blob);
    });

  it("hands the deployment layer's panel the queue open, as edited, and opens a version it gives", async () => {
    await open();
    const panel = fixture.debugElement.query(
      (node) => node.componentInstance instanceof StubLayerPanelComponent,
    ).componentInstance as StubLayerPanelComponent;
    expect(panel.path()).toBe('queues/up-for-renewal.json');
    expect(panel.file()).toEqual(RENEWALS);
    expect(panel.saveable()).toBe(page.saveState() === 'saveable');

    const live = { ...(RENEWALS as object), label: 'Renewals, live' };
    panel.openVersion.emit(live);
    await settle();
    expect(page.file()).toEqual(live);
  });

  it("offers the queues the app's menu opens, and opens one by its button", async () => {
    await settle();
    const offered = [
      ...root().querySelectorAll<HTMLOptionElement>('[data-picker="queue"] datalist option'),
    ];
    expect(offered.map((option) => option.value)).toEqual(['up-for-renewal', 'terminated']);
    expect(button('[data-action="open"]').disabled).toBe(true);
    page.idChosen.set('../etc');
    await settle();
    // An id that cannot name a queue is never asked for.
    expect(button('[data-action="open"]').disabled).toBe(true);
    page.open('../etc');
    expect(opened).toEqual([]);

    await open();
    expect(opened).toEqual(['up-for-renewal']);
    expect(columns()).toEqual(['contract:number', 'dc:title', 'contract:end']);
    expect(page.sorts()).toEqual([{ index: 0, field: 'contract:end', order: 'asc' }]);
    expect(page.facets().map((facet) => facet.aggregate)).toEqual(['contract_status']);
  });

  it('takes the queue ID and a facet to add as each key is typed, and the queue name once left', async () => {
    await settle();
    const typeInto = (selector: string, text: string, event: 'input' | 'change'): void => {
      const field = root().querySelector<HTMLInputElement>(`${selector} input`);
      if (!field) throw new Error(`no ${selector}`);
      field.value = text;
      field.dispatchEvent(new Event(event));
    };
    typeInto('[data-picker="queue"]', 'up-for-renewal', 'input');
    await settle();
    expect(page.idChosen()).toBe('up-for-renewal');
    expect(button('[data-action="open"]').disabled).toBe(false);

    await open();
    typeInto('[data-picker="add-facet"]', 'contract_category', 'input');
    await settle();
    expect(page.toAdd().facets).toBe('contract_category');
    expect(button('[data-action="add-facet"]').disabled).toBe(false);

    typeInto('[data-text="label"]', 'Renewals', 'input');
    await settle();
    expect(page.file()).toEqual(RENEWALS);
    typeInto('[data-text="label"]', 'Renewals', 'change');
    await settle();
    expect(page.file()?.['label']).toBe('Renewals');
  });

  it('previews the queue with the queue page, given the file as edited and read-only', async () => {
    await open();
    expect(stub()?.id()).toBe('up-for-renewal');
    expect(stub()?.content()).toEqual(RENEWALS);
    expect(stub()?.readOnly()).toBe(true);
    button('[data-column="contract:end"] [data-action="up"]').click();
    await settle();
    expect(columns()).toEqual(['contract:number', 'contract:end', 'dc:title']);
    expect(stub()?.content()).toBe(page.file());
    expect(page.changed()).toBe(true);
  });

  it('hides a column, and shows it again where it was', async () => {
    await open();
    button('[data-column="dc:title"] [data-action="hide"]').click();
    await settle();
    expect(columns()).toEqual(['contract:number', 'contract:end']);
    expect(page.hidden().map((column) => column.name)).toEqual(['dc:title']);
    button('[data-hidden="dc:title"] [data-action="show"]').click();
    await settle();
    expect(page.file()).toEqual(RENEWALS);
  });

  it("adds a column from the content model's properties, and sorts on a column", async () => {
    await open();
    const properties = [
      ...root().querySelectorAll<HTMLOptionElement>('[data-picker="add-column"] datalist option'),
    ].map((option) => option.value);
    expect(properties).toEqual(['contract:end', 'contract:number', 'contract:owner', 'dc:title']);
    page.choose('columns', 'contract:owner');
    page.add('columns');
    await settle();
    expect(columns().at(-1)).toBe('contract:owner');

    const sortable = [
      ...root().querySelectorAll<HTMLOptionElement>('[data-picker="add-sort"] option'),
    ].map((option) => option.value);
    expect(sortable).toEqual(['', 'contract:number', 'dc:title', 'contract:owner']);
    page.choose('sort', 'dc:title');
    page.add('sort');
    await settle();
    page.setOrder(page.sorts()[1], 'desc');
    page.remove('sort', 0);
    await settle();
    expect(page.file()?.['sort']).toEqual([{ field: 'dc:title', order: 'desc' }]);
  });

  it('adds, names, moves and removes a facet', async () => {
    await open();
    page.choose('facets', ' contract_category ');
    page.add('facets');
    await settle();
    page.setFacet(page.facets()[1], 'labelKey', 'contracts.facet.category');
    page.move('facets', 1, -1);
    await settle();
    expect(page.file()?.['facets']).toEqual([
      { aggregate: 'contract_category', labelKey: 'contracts.facet.category' },
      { aggregate: 'contract_status', label: 'Status' },
    ]);
    page.remove('facets', 0);
    page.remove('facets', 0);
    await settle();
    expect('facets' in (page.file() ?? {})).toBe(false);
  });

  describe('its row and bulk actions', () => {
    /** The choices a list's picker offers, by value, the empty choice left out. */
    const offeredIn = (list: string): string[] =>
      [...root().querySelectorAll<HTMLOptionElement>(`[data-picker="add-${list}"] option`)]
        .map((option) => option.value)
        .filter((value) => value !== '');

    /** Chooses `id` in the list's picker, as a person does, and presses its Add. */
    const addThrough = async (list: string, id: string): Promise<void> => {
      const select = root().querySelector<HTMLSelectElement>(`[data-picker="add-${list}"] select`);
      if (!select) throw new Error(`no picker for ${list}`);
      select.value = id;
      select.dispatchEvent(new Event('change'));
      await settle();
      button(`[data-action="add-${list}"]`).click();
      await settle();
    };

    const named = (list: string): (string | undefined)[] =>
      [...root().querySelectorAll<HTMLElement>(`[data-list="${list}"] [data-action-id]`)].map(
        (entry) => entry.dataset['actionId'],
      );

    it('offers those this build registers, and chooses, orders and removes them, in the file alone', async () => {
      await open();
      expect(offeredIn('rowActions')).toEqual([
        'app.rowActions.download',
        'app.rowActions.rename',
        'app.rowActions.copyTo',
        'app.rowActions.moveTo',
        'app.rowActions.delete',
      ]);
      expect(offeredIn('bulkActions')).toEqual([
        'app.bulkActions.downloadZip',
        'app.bulkActions.addToCollection',
        'app.bulkActions.compare',
        'app.bulkActions.addToClipboard',
        'app.bulkActions.publish',
        'app.bulkActions.delete',
      ]);
      expect(root().querySelector('[data-part="rowActions"]')?.textContent).toContain(
        'No row action.',
      );

      await addThrough('rowActions', 'app.rowActions.download');
      await addThrough('rowActions', 'app.rowActions.rename');
      await addThrough('bulkActions', 'app.bulkActions.downloadZip');
      expect(named('rowActions')).toEqual(['app.rowActions.download', 'app.rowActions.rename']);
      // One named is no longer offered: a list names an action once.
      expect(offeredIn('rowActions')).not.toContain('app.rowActions.download');
      // Each is written where the queue format lists its key, after the facets.
      expect(Object.keys(page.file() ?? {})).toEqual([
        'version',
        'labelKey',
        'pageProvider',
        'columns',
        'sort',
        'facets',
        'pageSize',
        'rowActions',
        'bulkActions',
      ]);
      expect(
        root().querySelector('[data-action-id="app.rowActions.download"]')?.textContent,
      ).toContain('registered by this build');

      button('[data-action-id="app.rowActions.rename"] [data-action="up"]').click();
      await settle();
      expect(page.file()?.['rowActions']).toEqual([
        'app.rowActions.rename',
        'app.rowActions.download',
      ]);
      expect(page.findings()).toEqual([]);
      expect(page.saveState()).toBe('saveable');
      // The preview is given the file as edited, read-only: it offers and runs none of them.
      expect(stub()?.content()).toBe(page.file());
      expect(stub()?.readOnly()).toBe(true);

      button('[data-action-id="app.rowActions.rename"] [data-action="remove"]').click();
      button('[data-action-id="app.bulkActions.downloadZip"] [data-action="remove"]').click();
      await settle();
      button('[data-action-id="app.rowActions.download"] [data-action="remove"]').click();
      await settle();
      // A list left empty is taken out, as a queue with no action writes none.
      expect(page.file()).toEqual(RENEWALS);
      expect(page.changed()).toBe(false);
    });

    it("says that only the registered ones are offered without the app's actions.json", async () => {
      await open({ ...RENEWALS, rowActions: ['contracts.contract.renew'] });
      expect(
        root().querySelector('[data-part="rowActions"] [data-offered]')?.textContent,
      ).toContain('Offered: only the actions this build registers.');
      expect(offeredIn('rowActions')).not.toContain('contracts.contract.renew');
      // The app's own action, named, is unknown here, and the validator refuses it, as said above.
      expect(
        root()
          .querySelector('[data-action-id="contracts.contract.renew"]')
          ?.getAttribute('data-from'),
      ).toBe('unknown');
      expect(page.saveState()).toBe('refused');
      expect(root().querySelector('[data-actions]')?.textContent).toContain(
        'No actions.json with actions is served for the app open',
      );
    });

    it("offers the app's own once its actions.json is read, each where its on shows it", async () => {
      actions.next({ state: 'reading' });
      await open();
      expect(
        root().querySelector('[data-part="rowActions"] [data-offered]')?.textContent,
      ).toContain("The app's own are offered once its actions.json has been read.");
      expect(offeredIn('rowActions')).not.toContain('contracts.contract.renew');
      actions.next({
        state: 'read',
        value: {
          version: 2,
          actions: [
            { id: 'contracts.contract.renew', label: 'Renew', on: ['record', 'row'] },
            { id: 'contracts.contract.close', label: 'Close', on: ['bulk'] },
            { id: 'contracts.contract.archive', label: 'Archive' },
          ],
        },
      });
      await settle();
      expect(offeredIn('rowActions').at(-1)).toBe('contracts.contract.renew');
      expect(offeredIn('bulkActions').at(-1)).toBe('contracts.contract.close');
      // An action on the record alone shows on no row, and in no bulk.
      expect([...offeredIn('rowActions'), ...offeredIn('bulkActions')]).not.toContain(
        'contracts.contract.archive',
      );
      const renew = [
        ...root().querySelectorAll<HTMLOptionElement>('[data-picker="add-rowActions"] option'),
      ].find((option) => option.value === 'contracts.contract.renew');
      expect(renew?.textContent?.trim()).toBe("contracts.contract.renew, the app's own");
      expect(
        root().querySelector('[data-part="rowActions"] [data-offered]')?.textContent,
      ).toContain("then the app's own");

      await addThrough('rowActions', 'contracts.contract.renew');
      expect(page.file()?.['rowActions']).toEqual(['contracts.contract.renew']);
      expect(
        root().querySelector('[data-action-id="contracts.contract.renew"]')?.textContent,
      ).toContain("the app's own, from its actions.json");
      expect(page.findings()).toEqual([]);
      expect(page.saveState()).toBe('saveable');
    });

    it('refuses an unknown action: never offered nor added, and the validator refuses one named', async () => {
      await open();
      page.choose('rowActions', 'acme.made.up');
      page.add('rowActions');
      page.choose('bulkActions', 'app.rowActions.download');
      page.add('bulkActions');
      await settle();
      expect(page.file()).toEqual(RENEWALS);

      await open(
        { ...RENEWALS, bulkActions: ['acme.made.up', 'app.bulkActions.compare'] },
        'other',
      );
      const unknown = root().querySelector('[data-action-id="acme.made.up"]');
      expect(unknown?.getAttribute('data-from')).toBe('unknown');
      expect(unknown?.textContent).toContain(
        "unknown: neither registered by this build nor among the app's own actions",
      );
      expect(page.findings()).toEqual([
        {
          path: 'bulkActions[0]',
          kind: 'unknown',
          message: 'the bulk action "acme.made.up" is not registered',
        },
      ]);
      expect(page.saveState()).toBe('refused');
      expect(root().querySelector('.layout-designer__findings')?.textContent).toContain(
        'bulkActions[0]',
      );
      button('[data-action-id="acme.made.up"] [data-action="remove"]').click();
      await settle();
      expect(page.findings()).toEqual([]);
      expect(page.saveState()).toBe('saveable');
    });

    it('names each button apart, by its list and its action, and moves the focus with it', async () => {
      await open({
        ...RENEWALS,
        rowActions: ['app.rowActions.download', 'app.rowActions.rename'],
        bulkActions: ['app.bulkActions.downloadZip'],
      });
      const label = (selector: string): string | null | undefined =>
        root().querySelector(`${selector} button`)?.getAttribute('aria-label');
      expect(label('[data-action-id="app.rowActions.download"] [data-action="up"]')).toBe(
        'Move the row action app.rowActions.download up',
      );
      expect(label('[data-action-id="app.rowActions.download"] [data-action="down"]')).toBe(
        'Move the row action app.rowActions.download down',
      );
      expect(label('[data-action-id="app.rowActions.rename"] [data-action="remove"]')).toBe(
        'Remove the row action app.rowActions.rename',
      );
      expect(label('[data-action-id="app.bulkActions.downloadZip"] [data-action="remove"]')).toBe(
        'Remove the bulk action app.bulkActions.downloadZip',
      );
      const focused = (): string => {
        const element = document.activeElement as HTMLElement | null;
        const control = element?.closest<HTMLElement>('[data-action],[data-picker]');
        return `${element?.closest('[data-action-id]')?.getAttribute('data-action-id') ?? ''}:${control?.dataset['action'] ?? control?.dataset['picker'] ?? ''}`;
      };
      button('[data-action-id="app.rowActions.download"] [data-action="down"]').click();
      await settle();
      // Moved last, its Down is off, so the focus is on its Up.
      expect(focused()).toBe('app.rowActions.download:up');
      button('[data-action-id="app.rowActions.rename"] [data-action="remove"]').click();
      await settle();
      expect(focused()).toBe('app.rowActions.download:remove');
      button('[data-action-id="app.bulkActions.downloadZip"] [data-action="remove"]').click();
      await settle();
      expect(focused()).toBe(':add-bulkActions');
      expect(document.activeElement).toBeInstanceOf(HTMLSelectElement);
      await addThrough('bulkActions', 'app.bulkActions.compare');
      expect(focused()).toBe('app.bulkActions.compare:remove');
    });
  });

  describe('saving', () => {
    it('downloads a queue the validator finds nothing in, as the package holds it', async () => {
      await open();
      button('[data-column="contract:end"] [data-action="up"]').click();
      await settle();
      expect(root().querySelector('[data-verdict="none"]')).not.toBeNull();
      button('[data-action="download"]').click();
      expect(clicked).toEqual([{ download: 'up-for-renewal.json' }]);
      // As the repository's Prettier lays the file out: on one line what fits in 100 columns.
      expect(await blobText(created[0])).toBe(
        [
          '{',
          '  "version": 2,',
          '  "labelKey": "contracts.queue.up-for-renewal",',
          '  "pageProvider": "contracts_up_for_renewal",',
          '  "columns": [',
          '    "contract:number",',
          '    { "field": "contract:end", "widget": "relative-date" },',
          '    { "field": "dc:title", "labelKey": "contracts.field.title" }',
          '  ],',
          '  "sort": [{ "field": "contract:end", "order": "asc" }],',
          '  "facets": [{ "aggregate": "contract_status", "label": "Status" }],',
          '  "pageSize": 50',
          '}',
          '',
        ].join('\n'),
      );
    });

    it('refuses to save a queue the validator refuses, whatever calls it', async () => {
      await open();
      // A queue needs a name: its key taken out, it has neither label nor key.
      page.setName('labelKey', '');
      await settle();
      expect(page.findings()).toEqual([
        { path: '', kind: 'structure', message: 'needs a "label" or a "labelKey"' },
      ]);
      expect(page.saveState()).toBe('refused');
      expect(button('[data-action="download"]').disabled).toBe(true);
      expect(root().querySelector('[data-save="refused"]')).not.toBeNull();
      page.download();
      expect(created).toEqual([]);
      expect(clicked).toEqual([]);

      page.setName('label', 'Up for renewal');
      await settle();
      expect(page.saveState()).toBe('saveable');
      page.download();
      expect(clicked).toHaveLength(1);
    });

    it('refuses a queue with no column, and the queue page draws none', async () => {
      await open();
      for (const name of ['contract:number', 'dc:title', 'contract:end']) {
        button(`[data-column="${name}"] [data-action="hide"]`).click();
        await settle();
      }
      expect(page.findings().map((finding) => finding.path)).toEqual(['columns']);
      expect(page.saveState()).toBe('refused');
      expect(stub()).toBeUndefined();
      expect(root().querySelector('[data-preview="refused"]')?.textContent).toContain(
        'columns: needs a list of columns',
      );
      page.download();
      expect(created).toEqual([]);
    });

    describe("the app's own actions", () => {
      const MINE = { ...RENEWALS, rowActions: ['contracts.contract.renew'] };
      const ACTIONS = {
        version: 2,
        actions: [{ id: 'contracts.contract.renew', label: 'Renew', on: ['record', 'row'] }],
      };

      it('refuses a queue naming one, as the pipeline does without actions.json, and says why', async () => {
        await open(MINE);
        expect(page.findings().map((finding) => [finding.path, finding.kind])).toEqual([
          ['rowActions[0]', 'unknown'],
        ]);
        expect(page.saveState()).toBe('refused');
        expect(root().querySelector('[data-actions]')?.textContent).toContain(
          'No actions.json with actions is served for the app open',
        );
      });

      it("checks it with the app's actions.json once it is read, as the pipeline does", async () => {
        actions.next({ state: 'reading' });
        await open(MINE);
        expect(page.saveState()).toBe('checking');
        // What is found so far is listed: the action is unknown until the app's are read.
        expect(root().querySelector('[data-verdict]')?.getAttribute('data-verdict')).toBe(
          'refused',
        );
        expect(root().querySelector('[data-save="checking"]')).not.toBeNull();
        page.download();
        expect(created).toEqual([]);

        actions.next({ state: 'read', value: ACTIONS });
        await settle();
        expect(page.findings()).toEqual([]);
        expect(page.saveState()).toBe('saveable');
        expect(root().querySelector('[data-actions]')?.textContent).toContain(
          'checked against those of the app open, from its actions.json in the app registry',
        );
        page.download();
        expect(clicked).toEqual([{ download: 'up-for-renewal.json' }]);
      });

      it('does not say a queue can be saved while they are read, though nothing is found yet', async () => {
        actions.next({ state: 'reading' });
        await open();
        expect(page.findings()).toEqual([]);
        expect(root().querySelector('[data-verdict]')?.textContent).toContain(
          'The validator finds nothing so far.',
        );
        expect(button('[data-action="download"]').disabled).toBe(true);
      });

      it("does not claim an actions.json with no actions in it as the app's actions", async () => {
        actions.next({ state: 'read', value: { version: 2 } });
        await open(MINE);
        expect(page.saveState()).toBe('refused');
        expect(root().querySelector('[data-actions]')?.textContent).toContain(
          'No actions.json with actions is served for the app open',
        );
      });

      it('says why they could not be read, and refuses a queue naming one', async () => {
        actions.next({ state: 'failed', problem: 'HTTP 500' });
        await open(MINE);
        expect(page.saveState()).toBe('refused');
        expect(root().querySelector('[data-actions]')?.textContent).toContain(
          "The app's own actions, its actions.json, could not be read: HTTP 500.",
        );
      });
    });

    it('undoes every change', async () => {
      await open();
      button('[data-column="dc:title"] [data-action="hide"]').click();
      page.setName('label', 'Renewals');
      await settle();
      button('[data-action="reset"]').click();
      await settle();
      expect(page.file()).toEqual(RENEWALS);
      expect(page.hidden()).toEqual([]);
    });
  });

  it('says why a queue could not be opened, offers nothing to edit, and reads it again asked again', async () => {
    await settle();
    page.open('nope');
    await settle();
    source.next({ state: 'failed', problem: 'no queue is served there' });
    await settle();
    expect(root().querySelector('[data-source="failed"]')).not.toBeNull();
    expect(page.file()).toBeNull();
    expect(root().querySelector('[data-action="download"]')).toBeNull();

    page.open('nope');
    await settle();
    expect(opened).toEqual(['nope', 'nope']);
    source.next({ state: 'read', value: RENEWALS });
    await settle();
    expect(page.file()).toEqual(RENEWALS);
    // Open, it is not read again.
    page.open('nope');
    await settle();
    expect(opened).toEqual(['nope', 'nope']);
  });

  it("says why what was read is no queue, in the reader's language", async () => {
    await open(['not', 'a', 'queue']);
    expect(root().querySelector('[data-source="failed"]')?.textContent).toContain(
      'it is not a JSON object',
    );
  });

  it("says that a queue's own rule decides whom the preview is drawn for", async () => {
    await open();
    expect(root().querySelector('[data-preview="rule"]')).toBeNull();
    await open({ ...RENEWALS, visibleWhen: { type: 'app.rules.inGroup', parameters: ['x'] } }, 'x');
    expect(root().querySelector('[data-preview="rule"]')?.textContent).toContain(
      'drawn only if you are one of them',
    );
  });

  it('names every button of the editor apart, by the list it is in, a sort on a column included', async () => {
    // The sort is on contract:end, which is a column too: its buttons must not be the column's.
    await open({ ...RENEWALS, facets: [{ aggregate: 'contract_status' }, { aggregate: 'other' }] });
    // A hidden column's Show is among them.
    button('[data-column="dc:title"] [data-action="hide"]').click();
    await settle();
    const names = [
      ...root().querySelectorAll<HTMLButtonElement>('.layout-designer__editor button[aria-label]'),
    ].map((each) => each.getAttribute('aria-label'));
    expect(names.length).toBeGreaterThan(10);
    expect(names.filter((name, index) => names.indexOf(name) !== index)).toEqual([]);
    expect(names).toContain('Show the column dc:title again');
    const named = (list: string, action: string): string | null | undefined =>
      root()
        .querySelector(`[data-list="${list}"] > li:first-child [data-action="${action}"] button`)
        ?.getAttribute('aria-label');
    expect(named('columns', 'up')).toBe('Move the column contract:number up');
    expect(named('columns', 'down')).toBe('Move the column contract:number down');
    expect(named('columns', 'hide')).toBe('Hide the column contract:number');
    expect(named('sort', 'up')).toBe('Move the sort on contract:end up');
    expect(named('sort', 'down')).toBe('Move the sort on contract:end down');
    expect(named('facets', 'up')).toBe('Move the facet contract_status up');
    expect(named('facets', 'down')).toBe('Move the facet contract_status down');
  });

  it('moves the focus to the next Remove when a sort or a facet is removed, or to adding one', async () => {
    await open({
      ...RENEWALS,
      facets: [{ aggregate: 'a' }, { aggregate: 'b' }],
    });
    const focused = (): string | null => {
      // The focus is on the native control inside the `nxs-` element that names the action or the
      // picker: its button, or the facet's input. Read only off one of those.
      const element = document.activeElement as HTMLElement | null;
      const control =
        element instanceof HTMLButtonElement ||
        element instanceof HTMLInputElement ||
        element instanceof HTMLSelectElement
          ? element.closest<HTMLElement>('[data-action],[data-picker]')
          : null;
      return `${element?.closest('[data-facet],[data-part]')?.getAttribute('data-facet') ?? ''}:${control?.dataset['action'] ?? control?.dataset['picker'] ?? ''}`;
    };
    button('[data-facet="a"] [data-action="remove"]').click();
    await settle();
    expect(focused()).toBe('b:remove');
    button('[data-facet="b"] [data-action="remove"]').click();
    await settle();
    expect(focused()).toBe(':add-facet');
  });

  it('asks before a changed queue is lost, to another queue or another page', async () => {
    await open();
    expect(await firstValueFrom(page.leave())).toBe(true);
    page.setName('label', 'Renewals');
    await settle();
    page.open('terminated');
    await settle();
    expect(asked).toEqual([
      {
        component: NxsConfirmDialogComponent,
        data: {
          title: 'Discard your changes?',
          message:
            'Your changes to the up-for-renewal queue have not been downloaded, and will be lost.',
          confirmLabel: 'Discard changes',
        },
      },
    ]);
    expect(page.id()).toBe('up-for-renewal');
    expect(page.idChosen()).toBe('up-for-renewal');
    expect(await firstValueFrom(page.leave())).toBe(false);
    const held = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(held);
    expect(held.defaultPrevented).toBe(true);
  });

  it("names the order picker's choices anew when the catalogue changes, as the translate pipe did", async () => {
    await open({ ...RENEWALS, sort: [{ field: 'dc:title' }] });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation(
      translate.getCurrentLang() ?? 'en',
      { 'layout-designer': { queue: { 'order-none': 'Unsorted', 'order-asc': 'A to Z' } } },
      true,
    );
    await settle();
    expect(
      [...root().querySelectorAll<HTMLOptionElement>('[data-picker="order"] option')].map(
        (option) => option.textContent?.trim(),
      ),
    ).toEqual(['Unsorted', 'A to Z', 'Descending']);
  });

  it('moves the focus to adding a sort once the last sort is removed', async () => {
    await open();
    button('[data-sort="contract:end"] [data-action="remove"]').click();
    await settle();
    const element = document.activeElement;
    expect(element).toBeInstanceOf(HTMLSelectElement);
    expect(element?.closest('[data-picker]')?.getAttribute('data-picker')).toBe('add-sort');
  });

  it("keeps the queue's keyboard contract: each control's element, name, state, value and order", async () => {
    // A sort with no order, so that the order picker offers its "none" too; and a row action.
    await open({
      ...RENEWALS,
      sort: [{ field: 'contract:end', order: 'asc' }, { field: 'dc:title' }],
      rowActions: ['app.rowActions.download'],
    });
    button('[data-column="dc:title"] [data-action="hide"]').click();
    await settle();
    // A sort added, so that the sort picker is seen choosing nothing again.
    page.choose('sort', 'contract:number');
    await settle();
    button('[data-action="add-sort"]').click();
    await settle();
    expect(controlContract(root())).toEqual([
      'a "Layout files"',
      'a "Queues"',
      'input "Queue ID" = "up-for-renewal" suggests',
      'button "Open"',
      'h2 "The up-for-renewal queue" tabindex=-1',
      'input "Name text" = ""',
      'input "Name label key" = "contracts.queue.up-for-renewal"',
      'button "Move the column contract:number up" disabled',
      'button "Move the column contract:number down"',
      'button "Hide the column contract:number"',
      'button "Move the column contract:end up"',
      'button "Move the column contract:end down" disabled',
      'button "Hide the column contract:end"',
      'input "Add a column: a property" = "" suggests',
      'button "Add" disabled',
      'button "Show the column dc:title again"',
      'button "Move the sort on contract:end up" disabled',
      'button "Move the sort on contract:end down"',
      'button "Remove the sort on contract:end"',
      'select "Order of contract:end" [*Ascending | Descending]',
      'button "Move the sort on dc:title up"',
      'button "Move the sort on dc:title down"',
      'button "Remove the sort on dc:title"',
      'select "Order of dc:title" [*As the page provider sorts | Ascending | Descending]',
      'button "Move the sort on contract:number up"',
      'button "Move the sort on contract:number down" disabled',
      'button "Remove the sort on contract:number"',
      'select "Order of contract:number" [*Ascending | Descending]',
      'select "Sort on a column" [*Choose a column]',
      'button "Add" disabled',
      'button "Move the facet contract_status up" disabled',
      'button "Move the facet contract_status down" disabled',
      'button "Remove the facet contract_status"',
      'input "Name of the facet contract_status" = "Status"',
      'input "Label key of the facet contract_status" = ""',
      'input "Add a facet: an aggregate\'s ID" = ""',
      'button "Add" disabled',
      'button "Move the row action app.rowActions.download up" disabled',
      'button "Move the row action app.rowActions.download down" disabled',
      'button "Remove the row action app.rowActions.download"',
      'select "Add a row action" [*Choose an action | app.rowActions.rename, registered by this build | app.rowActions.copyTo, registered by this build | app.rowActions.moveTo, registered by this build | app.rowActions.delete, registered by this build]',
      'button "Add" disabled',
      'select "Add a bulk action" [*Choose an action | app.bulkActions.downloadZip, registered by this build | app.bulkActions.addToCollection, registered by this build | app.bulkActions.compare, registered by this build | app.bulkActions.addToClipboard, registered by this build | app.bulkActions.publish, registered by this build | app.bulkActions.delete, registered by this build]',
      'button "Add" disabled',
      'button "Download up-for-renewal.json"',
      'button "Undo every change"',
      'summary "up-for-renewal.json as it will be saved"',
    ]);
  });
});
