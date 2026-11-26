import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
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

  describe('saving', () => {
    it('downloads a queue the validator finds nothing in, as the package holds it', async () => {
      await open();
      button('[data-column="contract:end"] [data-action="up"]').click();
      await settle();
      expect(root().querySelector('[data-verdict="none"]')).not.toBeNull();
      button('[data-action="download"]').click();
      expect(clicked).toEqual([{ download: 'up-for-renewal.json' }]);
      expect(await blobText(created[0])).toBe(`${JSON.stringify(page.file(), null, 2)}\n`);
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

  it("keeps the queue's keyboard contract: every control's element, name, state and order", async () => {
    // A sort with no order, so that the order picker offers its "none" too.
    await open({
      ...RENEWALS,
      sort: [{ field: 'contract:end', order: 'asc' }, { field: 'dc:title' }],
    });
    button('[data-column="dc:title"] [data-action="hide"]').click();
    await settle();
    expect(controlContract(root())).toEqual([
      'a "Layout files"',
      'a "Queues"',
      'input "Queue ID" suggests',
      'button "Open"',
      'h2 "The up-for-renewal queue" tabindex=-1',
      'input "Name text"',
      'input "Name label key"',
      'button "Move the column contract:number up" disabled',
      'button "Move the column contract:number down"',
      'button "Hide the column contract:number"',
      'button "Move the column contract:end up"',
      'button "Move the column contract:end down" disabled',
      'button "Hide the column contract:end"',
      'input "Add a column: a property" suggests',
      'button "Add" disabled',
      'button "Show the column dc:title again"',
      'button "Move the sort on contract:end up" disabled',
      'button "Move the sort on contract:end down"',
      'button "Remove the sort on contract:end"',
      'select "Order of contract:end" [Ascending | Descending]',
      'button "Move the sort on dc:title up"',
      'button "Move the sort on dc:title down" disabled',
      'button "Remove the sort on dc:title"',
      'select "Order of dc:title" [As the page provider sorts | Ascending | Descending]',
      'select "Sort on a column" [Choose a column | contract:number]',
      'button "Add" disabled',
      'button "Move the facet contract_status up" disabled',
      'button "Move the facet contract_status down" disabled',
      'button "Remove the facet contract_status"',
      'input "Name of the facet contract_status"',
      'input "Label key of the facet contract_status"',
      'input "Add a facet: an aggregate\'s ID"',
      'button "Add" disabled',
      'button "Download up-for-renewal.json"',
      'button "Undo every change"',
      'summary "up-for-renewal.json as it will be saved"',
    ]);
  });
});
