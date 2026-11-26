import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { DocumentLayoutService, RECORD_PAGE_TODAY } from '@agentic-ui/shared/document-layouts';
import { AppConfigService } from '@nuxeo/satori-platform/app-config';
import { NxsDocumentListComponent, provideNxsComponents } from '@nuxeo/satori-platform/components';
import {
  DOCUMENT_RULE_EVALUATORS,
  EXTENSION_SLOTS,
  ExtensionActionRegistry,
  ExtensionRuleContextService,
  PACKAGED_BULK_ACTIONS,
  provideSatoriExtensions,
} from '@nuxeo/satori-platform/extensions';
import {
  PageProviderService,
  SelectionService,
  type NuxeoDocument,
  type PageProviderRequest,
  type PageProviderResults,
} from '@nuxeo/satori-platform/nuxeo-client';
import { Subject, of, type Observable } from 'rxjs';
import { vi } from 'vitest';

import { QueueService, type QueueLoad } from '../queue.service';
import { QueuePageComponent } from './queue-page';

/** A queue of claims for adjusters, as a Payers package would write one. */
const UNASSIGNED = {
  version: 2,
  label: 'Unassigned claims',
  pageProvider: 'payers_unassigned_claims',
  parameters: ['$currentRepository', 50],
  columns: ['claim:number', { field: 'claim:received', widget: 'relative-date' }],
  sort: [{ field: 'claim:received', order: 'asc' }],
  pageSize: 25,
  facets: [
    { aggregate: 'claim_type_agg', label: 'Claim type' },
    { aggregate: 'claim_state_agg', label: 'State' },
  ],
  rowActions: ['app.rowActions.download'],
  bulkActions: [
    'app.bulkActions.delete',
    'acme.bulkActions.ghost',
    'app.bulkActions.downloadZip',
    'app.bulkActions.compare',
  ],
  visibleWhen: { type: 'app.rules.inGroup', parameters: ['claims-adjusters'] },
};

const claim = (n: number): NuxeoDocument => ({
  uid: `c${n}`,
  title: `Claim ${n}`,
  type: 'Claim',
  path: `/claims/c${n}`,
  lastModified: '2026-11-01T00:00:00.000Z',
  properties: { 'claim:number': `CLM-${n}`, 'claim:received': '2026-11-20T09:00:00.000Z' },
});

const results = (
  entries: NuxeoDocument[],
  aggregations: PageProviderResults['aggregations'],
): PageProviderResults => ({
  entries,
  totalSize: entries.length,
  resultsCount: entries.length,
  currentPageSize: entries.length,
  currentPageIndex: 0,
  numberOfPages: 1,
  isNextPageAvailable: false,
  aggregations,
});

const AGGREGATIONS = {
  claim_type_agg: {
    type: 'terms',
    buckets: [
      { key: 'medical', docCount: 1200 },
      { key: 'dental', docCount: 34 },
    ],
  },
};

/** A Layer 2 bulk action with no handler: offered, it would do nothing. */
const GHOST = { id: 'acme.bulkActions.ghost', label: 'Ghost', icon: 'help', order: 5 };
/** A Layer 2 bulk action shown only for several rows: its `rule`, not its `enabledRule`. */
const MERGE = {
  id: 'acme.bulkActions.merge',
  label: 'Merge',
  icon: 'merge',
  order: 6,
  rule: 'app.rules.hasMultipleSelection',
};

describe('QueuePageComponent', () => {
  let fixture: ComponentFixture<QueuePageComponent>;
  let files: Record<string, QueueLoad>;
  let loads: string[];
  let execute: ReturnType<typeof vi.fn>;
  let pages: Subject<PageProviderResults>[];
  let warnings: string[];
  /** The linked records' search: each call is one request, with the ids it was given. */
  let linkedRecords: ReturnType<
    typeof vi.fn<
      (
        ids: readonly string[],
        schemas?: readonly string[],
      ) => Observable<ReadonlyMap<string, unknown> | null>
    >
  >;
  /** What a column's `show` reads of the types it links to. */
  let linkedProperty: ReturnType<
    typeof vi.fn<
      (
        types: readonly string[],
        show: string,
      ) => Observable<{ schema: string; definition: { type: string } } | null>
    >
  >;

  function create(groups: readonly string[] = ['claims-adjusters', 'members']): void {
    TestBed.configureTestingModule({
      imports: [QueuePageComponent, MatIconTestingModule],
      providers: [
        provideNxsComponents(),
        provideRouter([]),
        { provide: AppConfigService, useValue: { manifest: signal({ extensionLayers: [] }) } },
        provideSatoriExtensions({
          slots: {
            [EXTENSION_SLOTS['bulk-actions']]: [...PACKAGED_BULK_ACTIONS, GHOST, MERGE],
          },
          rules: DOCUMENT_RULE_EVALUATORS,
        }),
        {
          provide: QueueService,
          useValue: {
            load: (id: string): Observable<QueueLoad> => {
              loads.push(id);
              return of(files[id] ?? { kind: 'none' });
            },
          },
        },
        { provide: PageProviderService, useValue: { execute } },
        {
          provide: DocumentLayoutService,
          useValue: {
            rowPropertiesOf: () =>
              of(
                new Map([
                  ['claim:number', { type: 'string' }],
                  ['claim:received', { type: 'date' }],
                  ['claim:move', { type: 'string' }],
                ]),
              ),
            vocabularyLabel: () => of(null),
            principalLabel: () => of(null),
            linkedRecords: (ids: readonly string[], schemas?: readonly string[]) =>
              schemas === undefined ? linkedRecords(ids) : linkedRecords(ids, schemas),
            linkedProperty: (types: readonly string[], show: string) => linkedProperty(types, show),
          },
        },
        { provide: RECORD_PAGE_TODAY, useValue: () => new Date('2026-11-23T12:00:00Z') },
      ],
    });
    // The packaged bulk actions' handlers, as the app registers them; not the ghost's.
    const ran: string[] = [];
    TestBed.inject(ExtensionActionRegistry).register(
      Object.fromEntries(
        PACKAGED_BULK_ACTIONS.map((action) => [action.id, { execute: () => ran.push(action.id) }]),
      ),
    );
    const context = TestBed.inject(ExtensionRuleContextService);
    context.username.set('ada');
    context.groups.set(groups);
  }

  async function open(id: string): Promise<void> {
    if (!fixture) fixture = TestBed.createComponent(QueuePageComponent);
    fixture.componentRef.setInput('id', id);
    await settle();
  }

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function answer(entries: NuxeoDocument[], aggregations: unknown = AGGREGATIONS) {
    const last = pages[pages.length - 1];
    last.next(results(entries, aggregations as PageProviderResults['aggregations']));
    last.complete();
    await settle();
  }

  const page = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const text = (selector: string): string =>
    (page().querySelector(selector)?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const list = (): NxsDocumentListComponent | null =>
    (fixture.debugElement.query(By.directive(NxsDocumentListComponent))?.componentInstance as
      NxsDocumentListComponent | undefined) ?? null;
  /** Each facet: its label, then each bucket as drawn, ticked or not. */
  const facets = (): string[][] =>
    [...page().querySelectorAll('.queue-facet')].map((facet) => [
      (facet.querySelector('legend')?.textContent ?? '').trim(),
      ...[...facet.querySelectorAll('mat-checkbox')].map((box) => {
        const input = box.querySelector('input') as HTMLInputElement;
        return `${input.checked ? '[x]' : '[ ]'} ${(box.textContent ?? '').replace(/\s+/g, ' ').trim()}`;
      }),
    ]);
  const tick = async (aggregate: string, key: string): Promise<void> => {
    const facet = page().querySelector(`.queue-facet[data-aggregate="${aggregate}"]`);
    const box = [...(facet?.querySelectorAll('mat-checkbox') ?? [])].find((candidate) =>
      (candidate.textContent ?? '').trim().startsWith(key),
    );
    (box?.querySelector('input') as HTMLInputElement).click();
    await settle();
  };
  const lastRequest = (): [string, PageProviderRequest] =>
    execute.mock.calls[execute.mock.calls.length - 1] as [string, PageProviderRequest];

  beforeEach(() => {
    files = { 'unassigned-claims': { kind: 'file', content: UNASSIGNED } };
    loads = [];
    pages = [];
    execute = vi.fn(() => {
      const next = new Subject<PageProviderResults>();
      pages.push(next);
      return next;
    });
    warnings = [];
    linkedRecords = vi.fn(() => of(new Map()));
    linkedProperty = vi.fn(() => of(null));
    vi.spyOn(console, 'warn').mockImplementation((message: unknown) =>
      warnings.push(String(message)),
    );
  });

  afterEach(() => {
    fixture?.destroy();
    fixture = undefined as unknown as ComponentFixture<QueuePageComponent>;
    vi.restoreAllMocks();
  });

  it('draws the queue under its name: its page provider, literal parameters, order and page size', async () => {
    create();
    await open('unassigned-claims');
    expect(loads).toEqual(['unassigned-claims']);
    expect(text('h1')).toBe('Unassigned claims');
    expect(lastRequest()).toEqual([
      'payers_unassigned_claims',
      {
        parameters: ['$currentRepository', '50'],
        pageSize: 25,
        pageIndex: 0,
        sort: [{ field: 'claim:received', order: 'asc' }],
      },
    ]);
    await answer([claim(1), claim(2)]);
    expect(list()?.label()).toBe('Unassigned claims');
    expect(
      list()
        ?.documents()
        .map((row) => row.uid),
    ).toEqual(['c1', 'c2']);
    expect(
      list()
        ?.columns()
        .map((column) => column.text?.(claim(1))),
    ).toEqual(['CLM-1', '3 days ago']);
  });

  it("draws a facet for each of the queue's aggregates the results have, with its buckets and counts", async () => {
    create();
    await open('unassigned-claims');
    expect(facets()).toEqual([]);
    await answer([claim(1)]);
    expect(facets()).toEqual([['Claim type', '[ ] medical (1,200)', '[ ] dental (34)']]);
    // The results have no `claim_state_agg`: the facet is not drawn, and the console says why, once.
    expect(
      warnings.filter((w) =>
        w.includes(
          'queues/unassigned-claims.json facets[1] not drawn: the page provider returns no aggregate "claim_state_agg"',
        ),
      ),
    ).toHaveLength(1);
  });

  describe("a facet on a reference, its buckets shown by their records' titles", () => {
    const FIRST = 'a72723a2-73cf-4d88-8804-5b58a360ab3e';
    const SECOND = 'f027e437-0795-4ec7-8e6c-4bb1dd4c75cc';
    /** A move the reader may not read, or that no longer exists: the search does not return it. */
    const GONE = '0a762678-0e77-4b58-8256-e5d7bce1f55e';
    const TITLES: Readonly<Record<string, string>> = {
      [FIRST]: 'Quinlan household',
      [SECOND]: 'Okafor household',
    };
    const BY_MOVE = {
      ...UNASSIGNED,
      columns: [...UNASSIGNED.columns, { field: 'claim:move', widget: 'document-link' }],
      facets: [
        { aggregate: 'claim_move_agg', label: 'Move', widget: 'document-link' },
        { aggregate: 'claim_type_agg', label: 'Claim type' },
      ],
    };
    const MOVES = {
      ...AGGREGATIONS,
      claim_move_agg: {
        type: 'terms',
        buckets: [
          { key: FIRST, docCount: 2 },
          { key: SECOND, docCount: 1 },
          { key: GONE, docCount: 1 },
          { key: 'not-an-id', docCount: 1 },
        ],
      },
    };
    const onMove = (n: number, move: string): NuxeoDocument => ({
      ...claim(n),
      properties: { ...claim(n).properties, 'claim:move': move },
    });
    const found = (ids: readonly string[]) =>
      new Map(
        ids
          .filter((id) => id in TITLES)
          .map((id) => [id, { title: TITLES[id], url: `/doc/${id}` }] as const),
      );

    beforeEach(() => {
      files = { 'claims-by-move': { kind: 'file', content: BY_MOVE } };
      linkedRecords = vi.fn((ids: readonly string[]) => of(found(ids)));
    });

    it("shows each bucket by its record's title, the id where it cannot be read, and filters by the id", async () => {
      create();
      await open('claims-by-move');
      await answer([onMove(1, FIRST), onMove(2, FIRST)], MOVES);
      expect(facets()).toEqual([
        [
          'Move',
          '[ ] Quinlan household (2)',
          '[ ] Okafor household (1)',
          `[ ] ${GONE} (1)`,
          '[ ] not-an-id (1)',
        ],
        ['Claim type', '[ ] medical (1,200)', '[ ] dental (34)'],
      ]);
      await tick('claim_move_agg', 'Okafor household');
      expect(lastRequest()[1].aggregates).toEqual({ claim_move_agg: [SECOND] });
    });

    it("reads each record once, the list's cells and the facet's buckets sharing the queue's lookup", async () => {
      create();
      await open('claims-by-move');
      await answer([onMove(1, FIRST), onMove(2, FIRST)], MOVES);
      const asked = linkedRecords.mock.calls.flatMap(([ids]) => [...ids]);
      // The first move is in a cell and a bucket, and read once; a value that is no id never.
      expect(asked.sort()).toEqual([FIRST, GONE, SECOND].sort());
      expect(asked).not.toContain('not-an-id');
    });

    it("reads each record once with the schema a show column reads, the facet's buckets included", async () => {
      files = {
        'claims-by-move': {
          kind: 'file',
          content: {
            ...BY_MOVE,
            columns: [
              ...BY_MOVE.columns,
              {
                field: 'claim:move',
                widget: 'document-link',
                label: 'Customer',
                parameters: { types: ['Move'], show: 'move:customer' },
              },
            ],
          },
        },
      };
      linkedProperty = vi.fn(() => of({ schema: 'move', definition: { type: 'string' } }));
      create();
      await open('claims-by-move');
      await answer([onMove(1, FIRST), onMove(2, SECOND)], MOVES);
      const asked = linkedRecords.mock.calls.flatMap(([ids]) => [...ids]);
      expect(asked.sort()).toEqual([FIRST, GONE, SECOND].sort());
      // Whichever asked first, the facet's or the list's, asked with the show column's schema.
      for (const [, schemas] of linkedRecords.mock.calls) expect(schemas).toEqual(['move']);
      expect(facets()[0][1]).toBe('[ ] Quinlan household (2)');
    });

    it('shows the id while its record is read, and after a search that fails', async () => {
      const answered = new Subject<ReadonlyMap<string, unknown> | null>();
      linkedRecords = vi.fn(() => answered);
      create();
      await open('claims-by-move');
      await answer([claim(1)], MOVES);
      expect(facets()[0]).toEqual([
        'Move',
        `[ ] ${FIRST} (2)`,
        `[ ] ${SECOND} (1)`,
        `[ ] ${GONE} (1)`,
        '[ ] not-an-id (1)',
      ]);
      answered.next(null);
      answered.complete();
      await settle();
      expect(facets()[0][1]).toBe(`[ ] ${FIRST} (2)`);
    });

    it("leaves a facet's buckets as their keys without the widget", async () => {
      files = {
        'claims-by-move': {
          kind: 'file',
          content: { ...BY_MOVE, facets: [{ aggregate: 'claim_move_agg', label: 'Move' }] },
        },
      };
      create();
      await open('claims-by-move');
      await answer([claim(1)], MOVES);
      expect(facets()[0][1]).toBe(`[ ] ${FIRST} (2)`);
      expect(linkedRecords).not.toHaveBeenCalled();
    });
  });

  it('sends a chosen bucket back to the page provider, from the first page, and clears the selection', async () => {
    create();
    await open('unassigned-claims');
    await answer([claim(1)]);
    TestBed.inject(SelectionService).toggle('c1', 'Claim 1');
    list()?.pageChange.emit(1);
    await settle();
    await tick('claim_type_agg', 'dental');
    expect(lastRequest()[1]).toEqual(
      expect.objectContaining({ pageIndex: 0, aggregates: { claim_type_agg: ['dental'] } }),
    );
    expect(TestBed.inject(SelectionService).selectedCount()).toBe(0);
    // While the next page loads, the facets keep the last results' buckets.
    expect(facets()).toEqual([['Claim type', '[ ] medical (1,200)', '[x] dental (34)']]);
    await answer([claim(2)], {
      claim_type_agg: {
        type: 'terms',
        buckets: [{ key: 'medical', docCount: 1200 }],
        extendedBuckets: [
          { key: 'medical', docCount: 1200 },
          { key: 'dental', docCount: 0 },
        ],
      },
    });
    expect(facets()).toEqual([['Claim type', '[ ] medical (1,200)', '[x] dental (0)']]);
    await tick('claim_type_agg', 'medical');
    expect(lastRequest()[1].aggregates).toEqual({ claim_type_agg: ['dental', 'medical'] });
    await tick('claim_type_agg', 'dental');
    await tick('claim_type_agg', 'medical');
    // Nothing chosen is nothing sent.
    expect(lastRequest()[1]).not.toHaveProperty('aggregates');
  });

  it("offers in the selection bar the queue's bulk actions that have a handler, and lets rows be selected", async () => {
    create();
    await open('unassigned-claims');
    await answer([claim(1), claim(2)]);
    const selection = TestBed.inject(SelectionService);
    // As the file lists them; the bar draws them in the slot's order. The ghost has no handler here.
    expect(selection.offeredBulkActions()).toEqual([
      'app.bulkActions.delete',
      'app.bulkActions.downloadZip',
      'app.bulkActions.compare',
    ]);
    expect(warnings).toContainEqual(
      expect.stringContaining(
        'bulkActions[1] "acme.bulkActions.ghost" has nothing to run it on this page; not offered',
      ),
    );
    expect(list()?.selectable()).toBe(true);
    list()?.selectedIds.set(['c2']);
    await settle();
    expect(selection.selectedItems()).toEqual([
      { id: 'c2', name: 'Claim 2', preview: null, type: 'Claim' },
    ]);
    expect(list()?.selectedIds()).toEqual(['c2']);
    list()?.selectedIds.set([]);
    await settle();
    expect(selection.selectedCount()).toBe(0);
  });

  it('gives the selection bar every bulk action back when the page goes', async () => {
    create();
    await open('unassigned-claims');
    const selection = TestBed.inject(SelectionService);
    expect(selection.offeredBulkActions()).not.toBeNull();
    fixture.destroy();
    expect(selection.offeredBulkActions()).toBeNull();
  });

  it('lets no row be selected when none of its bulk actions can run here', async () => {
    files['ghosts'] = {
      kind: 'file',
      content: { ...UNASSIGNED, bulkActions: ['acme.bulkActions.ghost'] },
    };
    create();
    await open('ghosts');
    await answer([claim(1)]);
    expect(list()?.selectable()).toBe(false);
    expect(TestBed.inject(SelectionService).offeredBulkActions()).toEqual([]);
  });

  it("draws a column only for the people its rule is for, as the record page's lists do", async () => {
    const supervisorsOnly = { type: 'app.rules.inGroup', parameters: ['claims-supervisors'] };
    files['ruled'] = {
      kind: 'file',
      content: {
        ...UNASSIGNED,
        columns: [
          'claim:number',
          { field: 'claim:received', widget: 'relative-date', visibleWhen: supervisorsOnly },
        ],
      },
    };
    create(['claims-adjusters']);
    await open('ruled');
    await answer([claim(1)]);
    expect(
      list()
        ?.columns()
        .map((column) => column.key),
    ).toEqual(['claim:number']);
    // Not left out for want of an answer: the page answered it.
    expect(
      warnings.some((w) => w.includes('has a rule the list was not given an answer for')),
    ).toBe(false);
  });

  it('draws the column for those its rule is for', async () => {
    const adjusters = { type: 'app.rules.inGroup', parameters: ['claims-adjusters'] };
    files['ruled'] = {
      kind: 'file',
      content: {
        ...UNASSIGNED,
        columns: ['claim:number', { field: 'claim:received', visibleWhen: adjusters }],
      },
    };
    create(['claims-adjusters']);
    await open('ruled');
    await answer([claim(1)]);
    expect(
      list()
        ?.columns()
        .map((column) => column.key),
    ).toEqual(['claim:number', 'claim:received']);
  });

  it('is hidden from someone none of its columns is for, and asks for nothing', async () => {
    const supervisorsOnly = { type: 'app.rules.inGroup', parameters: ['claims-supervisors'] };
    files['ruled'] = {
      kind: 'file',
      content: {
        ...UNASSIGNED,
        columns: [{ field: 'claim:number', visibleWhen: supervisorsOnly }],
      },
    };
    create(['claims-adjusters']);
    await open('ruled');
    expect(text('.queue-page__message')).toBe('This queue is not shown to you.');
    expect(execute).not.toHaveBeenCalled();
  });

  it('lets rows be selected for a bulk action that is offered for several rows only', async () => {
    files['several'] = {
      kind: 'file',
      content: { ...UNASSIGNED, bulkActions: ['acme.bulkActions.merge'] },
    };
    create();
    TestBed.inject(ExtensionActionRegistry).register({
      'acme.bulkActions.merge': { execute: () => undefined },
    });
    await open('several');
    await answer([claim(1), claim(2)]);
    expect(list()?.selectable()).toBe(true);
    expect(TestBed.inject(SelectionService).offeredBulkActions()).toEqual([
      'acme.bulkActions.merge',
    ]);
  });

  it('is hidden while its rule does not pass, and asks the page provider for nothing', async () => {
    create(['claims-supervisors']);
    await open('unassigned-claims');
    expect(text('h1')).toBe('Queue');
    expect(text('.queue-page__message')).toBe('This queue is not shown to you.');
    expect(execute).not.toHaveBeenCalled();
    expect(TestBed.inject(SelectionService).offeredBulkActions()).toEqual([]);
  });

  it('is hidden from everyone when its rule is one this build cannot answer', async () => {
    files['night'] = {
      kind: 'file',
      content: { ...UNASSIGNED, visibleWhen: { type: 'acme.rules.isNightShift', parameters: [] } },
    };
    create();
    await open('night');
    expect(text('.queue-page__message')).toBe('This queue is not shown to you.');
    expect(execute).not.toHaveBeenCalled();
    expect(warnings).toContainEqual(expect.stringContaining('queues/night.json visibleWhen'));
  });

  it('says when no queue is configured with the name, and when the file is refused', async () => {
    files['broken'] = { kind: 'file', content: { ...UNASSIGNED, version: 1 } };
    files['unreadable'] = { kind: 'unreadable', reason: 'HTTP 500' };
    create();
    await open('missing');
    expect(text('.queue-page__message')).toBe('No queue is configured with this name.');
    await open('broken');
    expect(text('.queue-page__message')).toBe('The queue could not be read.');
    expect(warnings).toContainEqual(expect.stringContaining('queues/broken.json refused: version'));
    await open('unreadable');
    expect(text('.queue-page__message')).toBe('The queue could not be read.');
    expect(warnings).toContainEqual(
      '[agentic-ui-queues] queues/unreadable.json not loaded: HTTP 500',
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it("opens another queue with none of the last one's buckets chosen", async () => {
    files['open-claims'] = {
      kind: 'file',
      content: { ...UNASSIGNED, label: 'Open claims', pageProvider: 'payers_open_claims' },
    };
    create();
    await open('unassigned-claims');
    await answer([claim(1)]);
    await tick('claim_type_agg', 'dental');
    await open('open-claims');
    expect(text('h1')).toBe('Open claims');
    expect(lastRequest()).toEqual([
      'payers_open_claims',
      expect.not.objectContaining({ aggregates: expect.anything() }),
    ]);
    expect(facets()).toEqual([]);
  });
});
