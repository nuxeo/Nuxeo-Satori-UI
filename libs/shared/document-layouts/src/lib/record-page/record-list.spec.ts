import { LiveAnnouncer } from '@angular/cdk/a11y';
import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { By } from '@angular/platform-browser';
import { Router, provideRouter } from '@angular/router';
import { AppConfigService } from '@nuxeo/satori-platform/app-config';
import { NxsDocumentListComponent, provideNxsComponents } from '@nuxeo/satori-platform/components';
import {
  AppExtensionsService,
  EXTENSION_SLOTS,
  ExtensionActionRegistry,
  ExtensionRuleContextService,
  SURFACE_RULE_EVALUATORS,
  type ExtensionActionDescriptor,
  type ExtensionRule,
  type ExtensionRuleContext,
  provideSatoriExtensions,
} from '@nuxeo/satori-platform/extensions';
import {
  DocumentChangesService,
  type NuxeoDocument,
  type NuxeoDocumentList,
  PageProviderService,
} from '@nuxeo/satori-platform/nuxeo-client';
import { Subject, of, throwError, type Observable } from 'rxjs';

import { DocumentLayoutService } from '../document-layout.service';
import type { LayoutFieldType } from '../layout.model';
import type { LinkedRecord } from './linked-record';
import type { RecordListEntry, RecordPropertyField } from './record-layout';
import { RECORD_PAGE_TIME_ZONE, RECORD_PAGE_TODAY } from './record-clock';
import { RecordListComponent } from './record-list';

const column = (
  xpath: string,
  widget: string | null = null,
  parameters: Record<string, unknown> = {},
): RecordPropertyField => ({
  kind: 'property',
  place: `cards[1].related.columns[${xpath}]`,
  xpath,
  label: { keys: [], fallback: xpath.slice(xpath.indexOf(':') + 1) },
  widget,
  parameters,
  visibleWhen: null,
});

const CLAIMS: RecordListEntry = {
  pageProvider: 'member_claims',
  parameters: [{ field: 'ecm:uuid' }],
  columns: [
    column('claim:number'),
    column('claim:billedAmount', 'currency', { currency: 'USD' }),
    column('claim:status'),
  ],
  sort: [{ field: 'claim:serviceDate', order: 'desc' }],
  pageSize: 10,
  rowActions: ['acme.rowActions.flag', 'app.rowActions.download'],
};

/** The Claim type's properties, as the layout service reads them for a row. */
const CLAIM_PROPERTIES: ReadonlyMap<string, LayoutFieldType> = new Map<string, LayoutFieldType>([
  ['claim:number', { type: 'string' }],
  ['claim:billedAmount', { type: 'double' }],
  ['claim:status', { type: 'string', directory: 'claim_status' }],
  ['claim:member', { type: 'string' }],
]);

const WEI = 'a00e20f3-1398-4b64-827e-628bfdada64c';
const JOHN = '9cd9b1cf-6f0b-442f-afa0-c2539996ba30';
const MARIA = '9a651335-d3d4-434c-a7b4-afe7e5c0edae';
/** A member the reader may not read, or that no longer exists: the search does not return it. */
const GONE = '0a762678-0e77-4b58-8256-e5d7bce1f55e';
const TITLES: Readonly<Record<string, string>> = {
  [WEI]: 'Wei Chen',
  [JOHN]: 'John Smith',
  [MARIA]: 'Maria Alvarez',
};
const linked = (ids: readonly string[]): ReadonlyMap<string, LinkedRecord> =>
  new Map(
    ids
      .filter((id) => id in TITLES)
      .map((id): [string, LinkedRecord] => [id, { title: TITLES[id], url: `/doc/${id}` }]),
  );

const claim = (n: number, properties: Record<string, unknown> = {}): NuxeoDocument => ({
  uid: `c${n}`,
  title: `Claim ${n}`,
  type: 'Claim',
  path: `/claims/c${n}`,
  lastModified: '2026-11-01T00:00:00.000Z',
  properties: {
    'claim:number': `CLM-${n}`,
    'claim:billedAmount': 1250.5 * n,
    'claim:status': 'open',
    ...properties,
  },
});

const page = (
  entries: NuxeoDocument[],
  more: Partial<NuxeoDocumentList> = {},
): NuxeoDocumentList => ({
  entries,
  totalSize: entries.length,
  currentPageSize: entries.length,
  currentPageIndex: 0,
  numberOfPages: 1,
  isNextPageAvailable: false,
  ...more,
});

const FLAG: ExtensionActionDescriptor = {
  id: 'acme.rowActions.flag',
  label: 'Flag',
  order: 10,
  rule: 'test.rules.open',
};
const DOWNLOAD: ExtensionActionDescriptor = {
  id: 'app.rowActions.download',
  label: 'Download',
  order: 20,
};
const UNLISTED: ExtensionActionDescriptor = {
  id: 'acme.rowActions.other',
  label: 'Other',
  order: 30,
};
const ARCHIVE: ExtensionActionDescriptor = {
  id: 'acme.rowActions.archive',
  label: 'Archive',
  order: 40,
  enabledRule: 'test.rules.open',
};

describe('RecordListComponent', () => {
  let fixture: ComponentFixture<RecordListComponent>;
  let execute: ReturnType<typeof vi.fn>;
  let pages: Subject<NuxeoDocumentList>[];
  let rowProperties: (
    document: NuxeoDocument,
  ) => Observable<ReadonlyMap<string, LayoutFieldType> | null>;
  let vocabulary: Subject<string | null>;
  /** The linked records' search: each call is one request, with the ids it was given. */
  let linkedRecords: ReturnType<
    typeof vi.fn<(ids: readonly string[]) => Observable<ReadonlyMap<string, LinkedRecord> | null>>
  >;
  let flagged: ExtensionRuleContext[];
  let warnings: string[];

  beforeEach(() => {
    pages = [];
    execute = vi.fn(() => {
      const next = new Subject<NuxeoDocumentList>();
      pages.push(next);
      return next;
    });
    rowProperties = () => of(CLAIM_PROPERTIES);
    vocabulary = new Subject<string | null>();
    linkedRecords = vi.fn((ids: readonly string[]) => of(linked(ids)));
    flagged = [];
    warnings = [];
    vi.spyOn(console, 'warn').mockImplementation((message: unknown) =>
      warnings.push(String(message)),
    );
    TestBed.configureTestingModule({
      imports: [RecordListComponent, MatIconTestingModule],
      providers: [
        provideNxsComponents(),
        provideRouter([]),
        { provide: AppConfigService, useValue: { manifest: signal({ extensionLayers: [] }) } },
        provideSatoriExtensions({
          slots: { [EXTENSION_SLOTS.rowActions]: [FLAG, DOWNLOAD, UNLISTED, ARCHIVE] },
          rules: {
            'test.rules.open': (context) =>
              context.document?.properties['claim:status'] !== 'closed',
          },
        }),
        { provide: PageProviderService, useValue: { execute } },
        {
          provide: DocumentLayoutService,
          useValue: {
            rowPropertiesOf: (document: NuxeoDocument) => rowProperties(document),
            vocabularyLabel: (directory: string, id: string) =>
              directory === 'claim_status' && id === 'open' ? vocabulary : of(null),
            principalLabel: () => of(null),
            linkedRecords: (ids: readonly string[]) => linkedRecords(ids),
          },
        },
        { provide: RECORD_PAGE_TODAY, useValue: () => new Date('2026-11-23T12:00:00Z') },
        // Neither UTC, where CI runs, nor +05:30: a cell shown in the wrong zone shows another day.
        { provide: RECORD_PAGE_TIME_ZONE, useValue: '-0800' },
      ],
    });
    const run = (context: ExtensionRuleContext) => flagged.push(context);
    TestBed.inject(ExtensionActionRegistry).register({
      'acme.rowActions.flag': { execute: run },
      'acme.rowActions.other': { execute: run },
    });
  });

  afterEach(() => vi.restoreAllMocks());

  async function render(
    parameters: readonly string[] | null = ['m1'],
    list: RecordListEntry = CLAIMS,
  ): Promise<HTMLElement> {
    fixture = TestBed.createComponent(RecordListComponent);
    fixture.componentRef.setInput('list', list);
    fixture.componentRef.setInput('parameters', parameters);
    fixture.componentRef.setInput('label', 'Claims');
    fixture.componentRef.setInput('source', 'Member/view layout: cards[1]');
    await settle();
    return fixture.nativeElement as HTMLElement;
  }

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function answer(
    rows: NuxeoDocument[],
    more: Partial<NuxeoDocumentList> = {},
  ): Promise<void> {
    pages[pages.length - 1].next(page(rows, more));
    pages[pages.length - 1].complete();
    await settle();
  }

  const list = (): NxsDocumentListComponent =>
    fixture.debugElement.query(By.directive(NxsDocumentListComponent))
      .componentInstance as NxsDocumentListComponent;

  const cells = (row: NuxeoDocument): string[] =>
    list()
      .columns()
      .map((c) => c.text?.(row) ?? '');

  it("asks for the first page with the record's parameters, the file's page size and its order", async () => {
    await render(['m1']);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith('member_claims', {
      parameters: ['m1'],
      pageSize: 10,
      pageIndex: 0,
      sort: [{ field: 'claim:serviceDate', order: 'desc' }],
    });
    expect(list().loading()).toBe(true);
    expect(list().label()).toBe('Claims');
    expect(list().selectable()).toBe(false);
  });

  it("shows each cell through its column's widget, and a vocabulary entry by its label once read", async () => {
    await render();
    const row = claim(1);
    await answer([row, claim(2)]);
    expect(
      list()
        .documents()
        .map((d) => d.uid),
    ).toEqual(['c1', 'c2']);
    expect(cells(row)).toEqual(['CLM-1', '$1,250.50', 'open']);
    vocabulary.next('Open');
    vocabulary.complete();
    await settle();
    expect(cells(row)).toEqual(['CLM-1', '$1,250.50', 'Open']);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('$1,250.50');
    expect(text).toContain('$2,501.00');
  });

  it("shows a value itself where the column's widget does not show the row's property, and says so", async () => {
    rowProperties = () =>
      of(
        new Map<string, LayoutFieldType>([
          ...CLAIM_PROPERTIES,
          ['claim:billedAmount', { type: 'string' }],
        ]),
      );
    await render();
    await answer([claim(1, { 'claim:billedAmount': 'about 1250' })]);
    expect(cells(claim(1, { 'claim:billedAmount': 'about 1250' }))[1]).toBe('about 1250');
    expect(
      warnings.some((w) =>
        w.includes('the widget "currency" does not show claim:billedAmount, a string value'),
      ),
    ).toBe(true);
  });

  it("shows a stored day as written and an instant on the reader's day, as the record page does", async () => {
    rowProperties = () =>
      of(
        new Map<string, LayoutFieldType>([
          ['claim:number', { type: 'string' }],
          ['claim:billedAmount', { type: 'date' }],
          ['claim:status', { type: 'date' }],
        ]),
      );
    const dates: RecordListEntry = {
      ...CLAIMS,
      columns: [
        column('claim:number'),
        column('claim:billedAmount', 'date', { format: 'short' }),
        column('claim:status', 'date', { format: 'short' }),
      ],
    };
    await render(['m1'], dates);
    // A day-only write is midnight UTC, the 23rd everywhere. 03:00 UTC on the 24th is the 24th in
    // UTC and at +05:30, and 19:00 on the 23rd at -08:00, the reader's zone here.
    const row = claim(1, {
      'claim:billedAmount': '2026-11-23T00:00:00.000Z',
      'claim:status': '2026-11-24T03:00:00.000Z',
    });
    await answer([row]);
    expect(cells(row)).toEqual(['CLM-1', '11/23/26', '11/23/26']);
  });

  it("leaves a cell empty where the row's type has no such property", async () => {
    rowProperties = () => of(new Map([['claim:number', { type: 'string' }]]));
    await render();
    await answer([claim(1)]);
    expect(cells(claim(1))).toEqual(['CLM-1', '', '']);
  });

  it('shows the empty state when the page provider returns nothing', async () => {
    const root = await render();
    await answer([]);
    expect(list().documents()).toEqual([]);
    expect(list().emptyHeading()).toBe('No records');
    expect(root.textContent).toContain('No records');
  });

  it('is not asked for while a parameter has no value, and shows the empty state', async () => {
    const root = await render(null);
    expect(execute).not.toHaveBeenCalled();
    expect(list().loading()).toBe(false);
    expect(root.textContent).toContain('No records');
  });

  it('shows the error state when the request fails, and asks again on retry', async () => {
    execute.mockReturnValueOnce(throwError(() => ({ status: 500 })));
    await render();
    expect(list().error()).toBe(500);
    expect(warnings.some((w) => w.includes('member_claims not read: HTTP 500'))).toBe(true);
    list().retry.emit();
    await settle();
    expect(execute).toHaveBeenCalledTimes(2);
    expect(list().error()).toBeNull();
  });

  it("sorts by a header on the server, from the first page, and back to the file's order when cleared", async () => {
    await render();
    await answer([claim(1)], { numberOfPages: 3, isNextPageAvailable: true });
    list().pageChange.emit(2);
    await settle();
    expect(execute).toHaveBeenLastCalledWith(
      'member_claims',
      expect.objectContaining({ pageIndex: 2 }),
    );
    list().sortChange.emit({ key: 'claim:number', direction: 'asc' });
    await settle();
    expect(execute).toHaveBeenLastCalledWith('member_claims', {
      parameters: ['m1'],
      pageSize: 10,
      pageIndex: 0,
      sort: [{ field: 'claim:number', order: 'asc' }],
    });
    expect(list().sort()).toEqual({ key: 'claim:number', direction: 'asc' });
    list().sortChange.emit(null);
    await settle();
    expect(execute).toHaveBeenLastCalledWith(
      'member_claims',
      expect.objectContaining({ sort: [{ field: 'claim:serviceDate', order: 'desc' }] }),
    );
  });

  it('pages through the results, keeping the order', async () => {
    await render();
    await answer([claim(1)], { totalSize: 25, numberOfPages: 3, isNextPageAvailable: true });
    expect(list().hasNextPage()).toBe(true);
    expect(list().totalSize()).toBe(25);
    list().pageChange.emit(1);
    await settle();
    expect(execute).toHaveBeenLastCalledWith('member_claims', {
      parameters: ['m1'],
      pageSize: 10,
      pageIndex: 1,
      sort: [{ field: 'claim:serviceDate', order: 'desc' }],
    });
    expect(list().pageIndex()).toBe(1);
  });

  it('shows no total where the server counted none, and pages on by whether another page follows', async () => {
    await render();
    await answer([claim(1)], {
      totalSize: -1,
      resultsCount: -1,
      numberOfPages: -1,
      isNextPageAvailable: true,
    });
    expect(list().totalSize()).toBe(-1);
    expect(list().hasNextPage()).toBe(true);
  });

  describe("the search index's window", () => {
    /**
     * As the search index answers past its window on Nuxeo 2025.10.18: the exact count, the
     * window as `resultsCountLimit` (docs/api-integrations.md, section 33). `isNextPageAvailable`
     * is true here even at the window's edge, where the server says false: the list must stop on
     * its own reading of the window, not on the server's word.
     */
    const PAST: Partial<NuxeoDocumentList> = {
      totalSize: 13_592,
      resultsCount: 13_592,
      resultsCountLimit: 10_000,
      numberOfPages: 1_360,
      isNextPageAvailable: true,
    };
    const notice = (root: HTMLElement): string =>
      root
        .querySelector('.record-list__window .nxs-banner__message')
        ?.textContent?.replace(/\s+/g, ' ')
        .trim() ?? '';

    it('never asks for a page that ends past the window, whatever the server says of a next one', async () => {
      await render();
      await answer([claim(1)], PAST);
      // Ten a page: page 999 holds results 9,991 to 10,000, the last the server serves.
      list().pageChange.emit(999);
      await settle();
      expect(execute).toHaveBeenCalledTimes(2);
      expect(execute).toHaveBeenLastCalledWith(
        'member_claims',
        expect.objectContaining({ pageIndex: 999, pageSize: 10 }),
      );
      await answer([claim(9_991)], { ...PAST, currentPageIndex: 999 });
      expect(list().hasNextPage()).toBe(false);
      // Asked for anyway, by the pager or anything else: refused, not sent.
      list().pageChange.emit(1_000);
      list().pageChange.emit(1_359);
      await settle();
      expect(execute).toHaveBeenCalledTimes(2);
      expect(list().pageIndex()).toBe(999);
      // Back within it, as before.
      list().pageChange.emit(998);
      await settle();
      expect(execute).toHaveBeenCalledTimes(3);
    });

    it('refuses a page past the window while the next page loads, from the window last read', async () => {
      await render();
      await answer([claim(1)], PAST);
      list().pageChange.emit(1);
      await settle();
      expect(list().loading()).toBe(true);
      list().pageChange.emit(5_000);
      await settle();
      expect(execute).toHaveBeenCalledTimes(2);
      expect(execute).toHaveBeenLastCalledWith(
        'member_claims',
        expect.objectContaining({ pageIndex: 1 }),
      );
    });

    it("disables the pager's next on the last page within the window", async () => {
      const root = await render();
      list().pageChange.emit(999);
      await settle();
      await answer([claim(9_991)], { ...PAST, currentPageIndex: 999 });
      const next = root.querySelector<HTMLButtonElement>('.nxs-pager__next');
      expect(next).not.toBeNull();
      expect(next?.disabled).toBe(true);
      // One page before it, the next one is still within it.
      list().pageChange.emit(998);
      await settle();
      await answer([claim(9_981)], { ...PAST, currentPageIndex: 998 });
      expect(root.querySelector<HTMLButtonElement>('.nxs-pager__next')?.disabled).toBe(false);
    });

    it("shows the server's whole count, not the window, and says how far the pages reach", async () => {
      const root = await render();
      await answer([claim(1)], PAST);
      expect(list().totalSize()).toBe(13_592);
      expect(root.querySelector('.nxs-pager__range')?.textContent?.trim()).toBe('1–1 of 13592');
      expect(notice(root)).toBe(
        'Only the first 10,000 of these 13,592 records can be paged through. Search for the records you need to find the others.',
      );
      fixture.componentRef.setInput('filterable', true);
      await settle();
      expect(notice(root)).toBe(
        'Only the first 10,000 of these 13,592 records can be paged through. Choose filters, or search, to narrow the list and find the others.',
      );
    });

    it('says nothing of a window the query fits in, nor of a repository that pages past 10,000', async () => {
      const root = await render();
      await answer([claim(1)], { ...PAST, totalSize: 6, resultsCount: 6, numberOfPages: 1 });
      expect(notice(root)).toBe('');
      list().pageChange.emit(1);
      await settle();
      await answer([claim(11)], { ...PAST, resultsCountLimit: 0, currentPageIndex: 1 });
      expect(notice(root)).toBe('');
      expect(list().hasNextPage()).toBe(true);
      list().pageChange.emit(1_100);
      await settle();
      expect(execute).toHaveBeenLastCalledWith(
        'member_claims',
        expect.objectContaining({ pageIndex: 1_100 }),
      );
    });

    it('keeps its notice while the next page loads, and leaves it out over a failure', async () => {
      const root = await render();
      await answer([claim(1)], PAST);
      list().pageChange.emit(1);
      await settle();
      expect(notice(root)).toContain('10,000 of these 13,592');
      pages[pages.length - 1].error({ status: 500 });
      await settle();
      expect(notice(root)).toBe('');
    });

    it('says "of more than" the limit the server stopped counting at, and pages on past it', async () => {
      const root = await render();
      await answer([claim(1)], {
        totalSize: -2,
        resultsCount: -2,
        resultsCountLimit: 200,
        numberOfPages: 0,
        isNextPageAvailable: true,
      });
      expect(list().totalSize()).toBe(-1);
      expect(list().totalMoreThan()).toBe(200);
      expect(root.querySelector('.nxs-pager__range')?.textContent?.trim()).toBe(
        '1–1 of more than 200',
      );
      expect(notice(root)).toBe('');
      list().pageChange.emit(30);
      await settle();
      expect(execute).toHaveBeenLastCalledWith(
        'member_claims',
        expect.objectContaining({ pageIndex: 30 }),
      );
    });

    it('starts again without a window for other buckets, and reads theirs from their first page', async () => {
      await render();
      await answer([claim(1)], PAST);
      fixture.componentRef.setInput('aggregates', { claim_status_agg: ['open'] });
      await settle();
      await answer([claim(2)], { ...PAST, totalSize: 40, resultsCount: 40, numberOfPages: 4 });
      list().pageChange.emit(3);
      await settle();
      expect(execute).toHaveBeenLastCalledWith(
        'member_claims',
        expect.objectContaining({ pageIndex: 3 }),
      );
    });
  });

  it("starts on the first page for another record, and never shows the last record's rows", async () => {
    await render(['m1']);
    await answer([claim(1)], { numberOfPages: 2, isNextPageAvailable: true });
    list().pageChange.emit(1);
    await settle();
    await answer([claim(2)]);
    fixture.componentRef.setInput('parameters', ['m2']);
    // One pass of change detection, the first frame the new record's card is drawn in.
    fixture.detectChanges();
    expect(list().documents()).toEqual([]);
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('CLM-2');
    await settle();
    expect(execute).toHaveBeenLastCalledWith(
      'member_claims',
      expect.objectContaining({ parameters: ['m2'], pageIndex: 0 }),
    );
    expect(list().documents()).toEqual([]);
    expect(list().loading()).toBe(true);
  });

  it('sorts by a property with one value, and not by a list, a complex value or a file', async () => {
    rowProperties = () =>
      of(
        new Map<string, LayoutFieldType>([
          ['claim:number', { type: 'string' }],
          ['claim:billedAmount', { type: 'string[]' }],
          ['claim:status', { type: 'complex' }],
        ]),
      );
    await render();
    expect(
      list()
        .columns()
        .map((c) => c.sortable),
    ).toEqual([false, false, false]);
    await answer([claim(1)]);
    expect(
      list()
        .columns()
        .map((c) => c.sortable),
    ).toEqual([true, false, false]);
  });

  it("asks again on retry when the file's order, turned back to from its header, failed", async () => {
    await render(['m1'], { ...CLAIMS, sort: [{ field: 'claim:number', order: 'desc' }] });
    await answer([claim(1)]);
    list().sortChange.emit({ key: 'claim:number', direction: 'asc' });
    await settle();
    await answer([claim(1)]);
    execute.mockReturnValueOnce(throwError(() => ({ status: 500 })));
    // Turned round and back to the file's order.
    list().sortChange.emit({ key: 'claim:number', direction: 'desc' });
    await settle();
    expect(list().error()).toBe(500);
    const asked = execute.mock.calls.length;
    list().retry.emit();
    await settle();
    expect(execute).toHaveBeenCalledTimes(asked + 1);
    expect(execute).toHaveBeenLastCalledWith(
      'member_claims',
      expect.objectContaining({ sort: [{ field: 'claim:number', order: 'desc' }] }),
    );
    expect(list().error()).toBeNull();
  });

  it("goes back to the file's order on retry when a chosen order failed", async () => {
    await render();
    await answer([claim(1)]);
    execute.mockReturnValueOnce(throwError(() => ({ status: 400 })));
    list().sortChange.emit({ key: 'claim:number', direction: 'asc' });
    await settle();
    // The error state shows a 400 as the server's failure.
    expect(list().error()).toBe(500);
    list().retry.emit();
    await settle();
    expect(execute).toHaveBeenLastCalledWith(
      'member_claims',
      expect.objectContaining({
        pageIndex: 0,
        sort: [{ field: 'claim:serviceDate', order: 'desc' }],
      }),
    );
  });

  /**
   * Through the header itself: the order it asks for and the one it announces are the same, and
   * neither is "cleared" while the rows are in the file's order.
   */
  it("turns the file's own order round from its header, and never announces it cleared", async () => {
    const byNumber: RecordListEntry = {
      ...CLAIMS,
      sort: [{ field: 'claim:number', order: 'desc' }],
    };
    await render(['m1'], byNumber);
    await answer([claim(1)]);
    const announce = vi.spyOn(TestBed.inject(LiveAnnouncer), 'announce').mockResolvedValue();
    const header = (): HTMLElement => {
      const th = [...(fixture.nativeElement as HTMLElement).querySelectorAll('th')].find(
        (cell) => cell.textContent?.trim() === 'number',
      );
      if (!th) throw new Error('no header "number"');
      return th;
    };
    const click = async (): Promise<void> => {
      (header().querySelector('.mat-sort-header-container') as HTMLElement).click();
      await settle();
    };
    expect(list().sort()).toBeNull();
    expect(header().getAttribute('aria-sort')).toBe('descending');
    const sent = (): unknown => (execute.mock.lastCall as [string, { sort: unknown }])[1].sort;
    const said = (): unknown => announce.mock.lastCall?.[0];

    await click();
    expect(sent()).toEqual([{ field: 'claim:number', order: 'asc' }]);
    expect(said()).toBe('Sorted by number, ascending');
    await answer([claim(1)]);
    expect(header().getAttribute('aria-sort')).toBe('ascending');

    await click();
    expect(sent()).toEqual([{ field: 'claim:number', order: 'desc' }]);
    expect(said()).toBe('Sorted by number, descending');
    await answer([claim(1)]);

    // From the file's own direction again: round, not cleared.
    await click();
    expect(sent()).toEqual([{ field: 'claim:number', order: 'asc' }]);
    expect(said()).toBe('Sorted by number, ascending');
    expect(announce.mock.calls.map(([message]) => message)).not.toContain(
      'Sort cleared, showing the default order',
    );
  });

  it("goes back to the file's whole order, every key of it, when its header is turned back", async () => {
    await render(['m1'], {
      ...CLAIMS,
      sort: [
        { field: 'claim:number', order: 'desc' },
        { field: 'claim:status', order: 'asc' },
      ],
    });
    await answer([claim(1)]);
    list().sortChange.emit({ key: 'claim:number', direction: 'asc' });
    await settle();
    await answer([claim(1)]);
    list().sortChange.emit({ key: 'claim:number', direction: 'desc' });
    await settle();
    expect(execute).toHaveBeenLastCalledWith(
      'member_claims',
      expect.objectContaining({
        sort: [
          { field: 'claim:number', order: 'desc' },
          { field: 'claim:status', order: 'asc' },
        ],
      }),
    );
    expect(list().sort()).toBeNull();
  });

  it("gives the list no default order on a header when no column shows the file's first key", async () => {
    await render();
    await answer([claim(1)]);
    // CLAIMS sorts by claim:serviceDate, which none of its columns shows.
    expect(list().defaultSort()).toBeNull();
    expect(list().sort()).toBeNull();
  });

  it("goes back to the file's order, and shows it on its header, when another column's is cleared", async () => {
    await render(['m1'], { ...CLAIMS, sort: [{ field: 'claim:number', order: 'desc' }] });
    await answer([claim(1)]);
    const header = (label: string): HTMLElement => {
      const th = [...(fixture.nativeElement as HTMLElement).querySelectorAll('th')].find(
        (cell) => cell.textContent?.trim() === label,
      );
      if (!th) throw new Error(`no header "${label}"`);
      return th;
    };
    const click = async (label: string): Promise<void> => {
      (header(label).querySelector('.mat-sort-header-container') as HTMLElement).click();
      await settle();
      await answer([claim(1)]);
    };
    await click('status');
    await click('status');
    expect(header('status').getAttribute('aria-sort')).toBe('descending');
    expect(header('number').getAttribute('aria-sort')).toBe('none');
    // From the status column's descending to the file's, also descending. The loader redraws the
    // table here, so the header's state is drawn afresh: the list's own spec pins it without one.
    await click('status');
    expect(execute).toHaveBeenLastCalledWith(
      'member_claims',
      expect.objectContaining({ sort: [{ field: 'claim:number', order: 'desc' }] }),
    );
    expect(list().sort()).toBeNull();
    expect(header('number').getAttribute('aria-sort')).toBe('descending');
    expect(header('status').getAttribute('aria-sort')).toBe('none');
  });

  it('draws no column whose rule it was not given an answer for, and says so', async () => {
    const gated: RecordListEntry = {
      ...CLAIMS,
      columns: [
        column('claim:number'),
        { ...column('claim:billedAmount'), visibleWhen: 'test.rules.open' },
      ],
    };
    await render(['m1'], gated);
    expect(
      list()
        .columns()
        .map((c) => c.key),
    ).toEqual(['claim:number']);
    expect(
      warnings.some((w) =>
        w.includes('has a rule the list was not given an answer for; not drawn'),
      ),
    ).toBe(true);
  });

  it("asks again when a column appears, to read its rows' definitions", async () => {
    const one: RecordListEntry = { ...CLAIMS, columns: [column('claim:number')] };
    await render(['m1'], one);
    await answer([claim(1)]);
    fixture.componentRef.setInput('list', CLAIMS);
    await settle();
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('asks once for a list given again as an equal copy', async () => {
    await render();
    fixture.componentRef.setInput('list', { ...CLAIMS, columns: [...CLAIMS.columns] });
    await settle();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('asks for the page on screen again when documents change, keeping its page and order', async () => {
    await render();
    await answer([claim(1)], { numberOfPages: 3, isNextPageAvailable: true });
    list().sortChange.emit({ key: 'claim:number', direction: 'asc' });
    await settle();
    await answer([claim(1)], { numberOfPages: 3, isNextPageAvailable: true });
    list().pageChange.emit(1);
    await settle();
    await answer([claim(2)]);
    expect(execute).toHaveBeenCalledTimes(3);

    TestBed.inject(DocumentChangesService).notify();
    await settle();

    expect(execute).toHaveBeenCalledTimes(4);
    expect(execute).toHaveBeenLastCalledWith('member_claims', {
      parameters: ['m1'],
      pageSize: 10,
      pageIndex: 1,
      sort: [{ field: 'claim:number', order: 'asc' }],
    });
    expect(list().loading()).toBe(true);
    await answer([claim(3)]);
    expect(
      list()
        .documents()
        .map((row) => row.uid),
    ).toEqual(['c3']);
  });

  it('asks nothing when documents change while a parameter has no value', async () => {
    await render(null);
    TestBed.inject(DocumentChangesService).notify();
    await settle();
    expect(execute).not.toHaveBeenCalled();
  });

  describe('a document-link column', () => {
    const MEMBERS: RecordListEntry = {
      ...CLAIMS,
      columns: [column('claim:number'), column('claim:member', 'document-link')],
    };
    const withMember = (n: number, member: unknown) => claim(n, { 'claim:member': member });
    const memberColumn = () => list().columns()[1];

    it("shows each member by title, a link opening it through the router, not the row's record", async () => {
      const root = await render(['m1'], MEMBERS);
      const rows = [withMember(1, WEI), withMember(2, JOHN)];
      await answer(rows);
      expect(memberColumn().text?.(rows[0])).toBe('Wei Chen');
      expect(memberColumn().links?.(rows[0])).toEqual([
        { text: 'Wei Chen', routerLink: `/doc/${WEI}` },
      ]);
      const link = root.querySelector<HTMLAnchorElement>(
        'tr[data-uid="c1"] a.nxs-document-list__link',
      );
      expect(link?.textContent?.trim()).toBe('Wei Chen');
      expect(link?.getAttribute('href')).toBe(`/doc/${WEI}`);
      const router = TestBed.inject(Router);
      const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
      const opened = vi.fn();
      list().open.subscribe(opened);
      link?.click();
      expect(opened).not.toHaveBeenCalled();
      expect(navigate).toHaveBeenCalledTimes(1);
      expect(router.serializeUrl(navigate.mock.calls[0][0] as never)).toBe(`/doc/${WEI}`);
      expect(warnings.some((w) => w.includes('document-link'))).toBe(false);
    });

    it('reads the members of the whole page in one request, each once', async () => {
      await render(['m1'], MEMBERS);
      await answer([
        withMember(1, WEI),
        withMember(2, JOHN),
        withMember(3, WEI),
        withMember(4, GONE),
      ]);
      expect(linkedRecords).toHaveBeenCalledTimes(1);
      expect(linkedRecords.mock.calls[0][0]).toEqual([GONE, JOHN, WEI].sort());
    });

    it('shows a member it may not read, or a value that is no id, as unavailable, never the id', async () => {
      const injected = `${WEI}' OR ecm:uuid IS NOT NULL OR ecm:uuid = '`;
      const root = await render(['m1'], MEMBERS);
      const rows = [withMember(1, GONE), withMember(2, injected)];
      await answer(rows);
      for (const row of rows) {
        expect(memberColumn().text?.(row)).toBe('Unavailable');
        expect(memberColumn().links?.(row)).toEqual([{ text: 'Unavailable', routerLink: null }]);
      }
      expect(root.querySelector('a.nxs-document-list__link')).toBeNull();
      const table = root.querySelector('table')?.textContent ?? '';
      expect(table).toContain('Unavailable');
      expect(table).not.toContain(GONE);
      expect(table).not.toContain(injected);
      expect(linkedRecords.mock.calls.flatMap(([ids]) => ids)).toEqual([GONE]);
    });

    it('asks only for the members a new page adds, and nothing for a page read before', async () => {
      await render(['m1'], MEMBERS);
      const first = [withMember(1, WEI), withMember(2, JOHN)];
      await answer(first, { numberOfPages: 2, isNextPageAvailable: true });
      list().pageChange.emit(1);
      await settle();
      await answer([withMember(3, JOHN), withMember(4, MARIA)], {
        currentPageIndex: 1,
        numberOfPages: 2,
      });
      list().pageChange.emit(0);
      await settle();
      await answer(first, { numberOfPages: 2, isNextPageAvailable: true });
      expect(linkedRecords.mock.calls.map(([ids]) => ids)).toEqual([[JOHN, WEI].sort(), [MARIA]]);
      expect(memberColumn().text?.(first[0])).toBe('Wei Chen');
    });
  });

  it("opens a row's record", async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    await render();
    await answer([claim(1)]);
    list().open.emit(claim(1));
    expect(navigate).toHaveBeenCalledWith('/doc/c1');
  });

  it('offers the listed row actions that have a handler here, while their rules pass for the row', async () => {
    await render();
    await answer([claim(1), claim(2, { 'claim:status': 'closed' })]);
    // Flag for the open claim; nothing for the closed one; never Download, which nothing in this
    // spec registers (the app does, with `providePackagedRowActions()`), nor Other, which the file
    // does not list.
    expect(list().rowActions()).toEqual({
      c1: [{ id: 'acme.rowActions.flag', label: 'Flag', icon: undefined, disabled: false }],
    });
    expect(
      warnings.filter((w) =>
        w.includes('the row action "app.rowActions.download" has nothing to run it on this page'),
      ),
    ).toHaveLength(1);
  });

  it('runs a row action with its row in focus, and none the file does not list', async () => {
    await render();
    const row = claim(1);
    await answer([row]);
    list().rowAction.emit({ action: { id: 'acme.rowActions.flag', label: 'Flag' }, document: row });
    expect(flagged.map((context) => context.document?.uid)).toEqual(['c1']);
    list().rowAction.emit({
      action: { id: 'acme.rowActions.other', label: 'Other' },
      document: row,
    });
    expect(flagged).toHaveLength(1);
  });

  it('does not run a listed action whose enabledRule fails for the row', async () => {
    TestBed.inject(ExtensionActionRegistry).register({
      'acme.rowActions.archive': { execute: (context) => flagged.push(context) },
    });
    await render(['m1'], { ...CLAIMS, rowActions: ['acme.rowActions.archive'] });
    const closed = claim(2, { 'claim:status': 'closed' });
    await answer([closed]);
    expect(list().rowActions()['c2']?.[0]).toMatchObject({
      id: 'acme.rowActions.archive',
      disabled: true,
    });
    list().rowAction.emit({
      action: { id: 'acme.rowActions.archive', label: 'Archive' },
      document: closed,
    });
    expect(flagged).toEqual([]);
  });

  it('filters by the buckets chosen, from the first page, keeping the order chosen from a header', async () => {
    await render();
    await answer([claim(1)], { numberOfPages: 3, isNextPageAvailable: true });
    list().sortChange.emit({ key: 'claim:number', direction: 'asc' });
    await settle();
    list().pageChange.emit(2);
    await settle();
    fixture.componentRef.setInput('aggregates', {
      claim_type_agg: ['medical', 'dental'],
      claim_state_agg: [],
    });
    await settle();
    // An aggregate with no bucket chosen filters nothing and is not sent; the keys are in order.
    expect(execute).toHaveBeenLastCalledWith('member_claims', {
      parameters: ['m1'],
      pageSize: 10,
      pageIndex: 0,
      sort: [{ field: 'claim:number', order: 'asc' }],
      aggregates: { claim_type_agg: ['dental', 'medical'] },
    });
    const asked = execute.mock.calls.length;
    // The same choice written another way is the same request.
    fixture.componentRef.setInput('aggregates', { claim_type_agg: ['medical', 'dental'] });
    await settle();
    expect(execute).toHaveBeenCalledTimes(asked);
  });

  it('hands each page on as the server returned it, with its aggregates', async () => {
    const loaded: unknown[] = [];
    await render();
    fixture.componentInstance.loaded.subscribe((page) => loaded.push(page));
    const aggregations = { claim_type_agg: { buckets: [{ key: 'medical', docCount: 1 }] } };
    await answer([claim(1)], { aggregations } as Partial<NuxeoDocumentList>);
    expect(loaded).toEqual([expect.objectContaining({ aggregations })]);
  });

  it('lets rows be selected only when asked, and keeps the selection two-way', async () => {
    await render();
    await answer([claim(1), claim(2)]);
    expect(list().selectable()).toBe(false);
    fixture.componentRef.setInput('selectable', true);
    fixture.componentRef.setInput('selectedIds', ['c2']);
    await settle();
    expect(list().selectable()).toBe(true);
    expect(list().selectedIds()).toEqual(['c2']);
    list().selectedIds.set(['c2', 'c1']);
    await settle();
    expect(fixture.componentInstance.selectedIds()).toEqual(['c2', 'c1']);
  });

  it("says what an empty list is with the caller's words, or the related records' own", async () => {
    await render();
    await answer([]);
    expect(list().emptyHeading()).toBe('No records');
    fixture.componentRef.setInput('emptyHeading', 'Nothing in this queue');
    await settle();
    expect(list().emptyHeading()).toBe('Nothing in this queue');
  });

  describe("a row's rules, against the state the page publishes about its own record", () => {
    /** What the record page around the list publishes about the Member: every flag set. */
    const PAGE_FLAGS = {
      favorite: true,
      locked: true,
      subscribed: true,
      inClipboard: true,
      hasVersion: true,
      aiEnabled: true,
      'busy.trash': true,
    };
    const PROBE = 'acme.rowActions.probe';

    function probe(descriptor: Partial<ExtensionActionDescriptor>): RecordListEntry {
      TestBed.inject(AppExtensionsService).register(EXTENSION_SLOTS.rowActions, [
        { id: PROBE, label: 'Probe', order: 50, ...descriptor },
      ]);
      TestBed.inject(ExtensionActionRegistry).register({
        [PROBE]: { execute: (context) => flagged.push(context) },
      });
      TestBed.inject(ExtensionRuleContextService).flags.set(PAGE_FLAGS);
      return { ...CLAIMS, rowActions: [PROBE] };
    }

    const pageStateRules = Object.keys(SURFACE_RULE_EVALUATORS).filter(
      (id) => id !== 'app.rules.isNote',
    );
    const shapes: [string, (id: string) => Partial<ExtensionActionDescriptor>][] = [
      ['its rule', (id) => ({ rule: id })],
      ['its rule, turned round', (id) => ({ rule: { type: 'core.not', parameters: [id] } })],
      [
        'its enabledRule, nested',
        (id) => ({
          enabledRule: {
            type: 'core.every',
            parameters: [{ type: 'core.some', parameters: [{ type: id, parameters: ['trash'] }] }],
          } as ExtensionRule,
        }),
      ],
    ];

    it.each(
      pageStateRules.flatMap((id) => shapes.map(([where, shape]) => [id, where, shape] as const)),
    )('does not offer or run a row action naming %s in %s', async (id, _where, shape) => {
      const row = claim(1);
      await render(['m1'], probe(shape(id)));
      await answer([row]);
      expect(list().rowActions()).toEqual({});
      list().rowAction.emit({ action: { id: PROBE, label: 'Probe' }, document: row });
      expect(flagged).toEqual([]);
    });

    /**
     * Said where the rule answered yes for the row and the action would otherwise be offered. One
     * whose rule answers no, as a bare page-state rule does with no flags, is left out before.
     */
    it('says in the console why such a row action is not offered', async () => {
      await render(
        ['m1'],
        probe({ rule: { type: 'core.not', parameters: ['app.rules.isLocked'] } }),
      );
      await answer([claim(1)]);
      expect(warnings).toContain(
        `[agentic-ui-layouts] Member/view layout: cards[1]: the row action "${PROBE}" names the rule "app.rules.isLocked", which is refused for a row: as packaged, it answers for the page's own record; not offered`,
      );
    });

    it("offers one by app.rules.isNote, which reads the row's own type", async () => {
      await render(['m1'], probe({ rule: 'app.rules.isNote' }));
      const note: NuxeoDocument = { ...claim(1), uid: 'n1', type: 'Note' };
      await answer([note, claim(2)]);
      expect(Object.keys(list().rowActions())).toEqual(['n1']);
    });

    it("gives a customer's own rule, and the run, no page flags for a row", async () => {
      TestBed.inject(AppExtensionsService).registerRules({
        'acme.rules.flagged': (context) => Object.keys(context.flags).length > 0,
      });
      const row = claim(1);
      await render(
        ['m1'],
        probe({ rule: { type: 'core.not', parameters: ['acme.rules.flagged'] } }),
      );
      await answer([row]);
      expect(
        list()
          .rowActions()
          ['c1']?.map((action) => action.id),
      ).toEqual([PROBE]);
      list().rowAction.emit({ action: { id: PROBE, label: 'Probe' }, document: row });
      expect(flagged).toHaveLength(1);
      expect(flagged[0].document?.uid).toBe('c1');
      expect(flagged[0].flags).toEqual({});
    });
  });

  it('does not run a listed action whose rule fails for the row', async () => {
    await render();
    const closed = claim(2, { 'claim:status': 'closed' });
    await answer([closed]);
    list().rowAction.emit({
      action: { id: 'acme.rowActions.flag', label: 'Flag' },
      document: closed,
    });
    expect(flagged).toEqual([]);
  });
});
