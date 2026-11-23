import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { By } from '@angular/platform-browser';
import { Router, provideRouter } from '@angular/router';
import { AppConfigService } from '@nuxeo/satori-platform/app-config';
import { NxsDocumentListComponent, provideNxsComponents } from '@nuxeo/satori-platform/components';
import {
  EXTENSION_SLOTS,
  ExtensionActionRegistry,
  type ExtensionActionDescriptor,
  type ExtensionRuleContext,
  provideSatoriExtensions,
} from '@nuxeo/satori-platform/extensions';
import {
  type NuxeoDocument,
  type NuxeoDocumentList,
  PageProviderService,
} from '@nuxeo/satori-platform/nuxeo-client';
import { Subject, of, throwError, type Observable } from 'rxjs';

import { DocumentLayoutService } from '../document-layout.service';
import type { LayoutFieldType } from '../layout.model';
import type { RecordListEntry, RecordPropertyField } from './record-layout';
import { RECORD_LIST_TODAY, RecordListComponent } from './record-list';

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
]);

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

describe('RecordListComponent', () => {
  let fixture: ComponentFixture<RecordListComponent>;
  let execute: ReturnType<typeof vi.fn>;
  let pages: Subject<NuxeoDocumentList>[];
  let rowProperties: (
    document: NuxeoDocument,
  ) => Observable<ReadonlyMap<string, LayoutFieldType> | null>;
  let vocabulary: Subject<string | null>;
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
          slots: { [EXTENSION_SLOTS.rowActions]: [FLAG, DOWNLOAD, UNLISTED] },
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
          },
        },
        { provide: RECORD_LIST_TODAY, useValue: () => new Date('2026-11-23T12:00:00Z') },
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

  it("starts on the first page for another record, and never shows the last record's rows", async () => {
    await render(['m1']);
    await answer([claim(1)], { numberOfPages: 2, isNextPageAvailable: true });
    list().pageChange.emit(1);
    await settle();
    await answer([claim(2)]);
    fixture.componentRef.setInput('parameters', ['m2']);
    await settle();
    expect(execute).toHaveBeenLastCalledWith(
      'member_claims',
      expect.objectContaining({ parameters: ['m2'], pageIndex: 0 }),
    );
    expect(list().documents()).toEqual([]);
    expect(list().loading()).toBe(true);
  });

  it('asks once for a list given again as an equal copy', async () => {
    await render();
    fixture.componentRef.setInput('list', { ...CLAIMS, columns: [...CLAIMS.columns] });
    await settle();
    expect(execute).toHaveBeenCalledTimes(1);
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
    // Flag for the open claim; nothing for the closed one; never Download, which no handler runs
    // here, nor Other, which the file does not list.
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
