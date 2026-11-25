/**
 * The queue page as the layout designer previews a queue it edits: given the file rather than
 * reading it, and read-only, so that nothing on it can change a record. Each read-only check has
 * its control, the same file drawn as the app draws it, so that a check cannot pass because the
 * page never offered the action at all.
 */
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
  ExtensionRuleContextService,
  PACKAGED_BULK_ACTIONS,
  PACKAGED_ROW_ACTIONS,
  provideSatoriExtensions,
} from '@nuxeo/satori-platform/extensions';
import {
  PageProviderService,
  SelectionService,
  type NuxeoDocument,
  type PageProviderRequest,
  type PageProviderResults,
} from '@nuxeo/satori-platform/nuxeo-client';
import { providePackagedRowActions } from '@nuxeo/satori-platform/ui';
import { Subject, of, type Observable } from 'rxjs';
import { vi } from 'vitest';

import { QueueService, type QueueLoad } from '../queue.service';
import { QueuePageComponent } from './queue-page';

const QUEUE = {
  version: 2,
  label: 'Unassigned claims',
  pageProvider: 'payers_unassigned_claims',
  columns: ['claim:number'],
  sort: [{ field: 'claim:number', order: 'asc' }],
  pageSize: 25,
  rowActions: ['app.rowActions.download', 'app.rowActions.delete', 'acme.rowActions.ghost'],
  bulkActions: ['app.bulkActions.delete'],
};

const claim = (n: number): NuxeoDocument => ({
  uid: `c${n}`,
  title: `Claim ${n}`,
  type: 'File',
  path: `/claims/c${n}`,
  lastModified: '2026-11-01T00:00:00.000Z',
  properties: { 'claim:number': `CLM-${n}` },
  contextParameters: { permissions: ['Read', 'Write', 'Remove'] },
});

const results = (entries: NuxeoDocument[]): PageProviderResults => ({
  entries,
  totalSize: entries.length,
  resultsCount: entries.length,
  currentPageSize: entries.length,
  currentPageIndex: 0,
  numberOfPages: 1,
  isNextPageAvailable: false,
});

describe('QueuePageComponent, given its file and read-only', () => {
  let fixture: ComponentFixture<QueuePageComponent>;
  let pages: Subject<PageProviderResults>[];
  let loads: string[];
  let warnings: string[];
  const execute = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    pages = [];
    loads = [];
    warnings = [];
    vi.spyOn(console, 'warn').mockImplementation((message: unknown) =>
      warnings.push(String(message)),
    );
    execute.mockImplementation(() => {
      const next = new Subject<PageProviderResults>();
      pages.push(next);
      return next;
    });
    TestBed.configureTestingModule({
      imports: [QueuePageComponent, MatIconTestingModule],
      providers: [
        provideNxsComponents(),
        provideRouter([]),
        { provide: AppConfigService, useValue: { manifest: signal({ extensionLayers: [] }) } },
        provideSatoriExtensions({
          slots: {
            [EXTENSION_SLOTS.rowActions]: PACKAGED_ROW_ACTIONS,
            [EXTENSION_SLOTS['bulk-actions']]: PACKAGED_BULK_ACTIONS,
          },
          rules: DOCUMENT_RULE_EVALUATORS,
          actions: { 'app.bulkActions.delete': { execute: () => undefined, wholeQuery: true } },
        }),
        providePackagedRowActions(),
        {
          provide: QueueService,
          useValue: {
            load: (id: string): Observable<QueueLoad> => {
              loads.push(id);
              return of({ kind: 'file', content: QUEUE });
            },
          },
        },
        { provide: PageProviderService, useValue: { execute } },
        {
          provide: DocumentLayoutService,
          useValue: {
            rowPropertiesOf: () => of(new Map([['claim:number', { type: 'string' }]])),
            vocabularyLabel: () => of(null),
            principalLabel: () => of(null),
          },
        },
        { provide: RECORD_PAGE_TODAY, useValue: () => new Date('2026-11-23T12:00:00Z') },
      ],
    });
    TestBed.inject(ExtensionRuleContextService).username.set('ada');
  });

  afterEach(() => {
    fixture?.destroy();
    vi.restoreAllMocks();
  });

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function draw(
    inputs: Record<string, unknown>,
    answer: PageProviderResults = results([claim(1), claim(2)]),
  ): Promise<void> {
    fixture = TestBed.createComponent(QueuePageComponent);
    for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
    await settle();
    const last = pages[pages.length - 1];
    last?.next(answer);
    last?.complete();
    await settle();
  }

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const list = (): NxsDocumentListComponent =>
    fixture.debugElement.query(By.directive(NxsDocumentListComponent))
      .componentInstance as NxsDocumentListComponent;
  const lastRequest = (): [string, PageProviderRequest] =>
    execute.mock.calls[execute.mock.calls.length - 1] as [string, PageProviderRequest];

  it('draws the file it is given, reads none, and leaves telling the console to its host', async () => {
    await draw({ id: 'unassigned-claims', content: QUEUE, readOnly: true });
    expect(loads).toEqual([]);
    expect(lastRequest()).toEqual([
      'payers_unassigned_claims',
      {
        parameters: [],
        pageSize: 25,
        pageIndex: 0,
        sort: [{ field: 'claim:number', order: 'asc' }],
      },
    ]);
    expect(
      list()
        .documents()
        .map((row) => row.uid),
    ).toEqual(['c1', 'c2']);
    // Under the host's headings, not a page of its own.
    expect(host().querySelector('h1')).toBeNull();
    expect(host().querySelector('h3.queue-page__title')?.textContent?.trim()).toBe(
      'Unassigned claims',
    );
    // The ghost row action is left out, as on any page, but the console is not told so here.
    expect(warnings.filter((warning) => warning.includes('rowActions[2]'))).toEqual([]);
  });

  it('draws the file again, and asks the page provider again, as it changes', async () => {
    await draw({ id: 'unassigned-claims', content: QUEUE, readOnly: true });
    const asked = execute.mock.calls.length;
    fixture.componentRef.setInput('content', {
      ...QUEUE,
      sort: [{ field: 'claim:number', order: 'desc' }],
    });
    await settle();
    expect(execute.mock.calls.length).toBe(asked + 1);
    expect(lastRequest()[1].sort).toEqual([{ field: 'claim:number', order: 'desc' }]);
  });

  it('offers no row action read-only, where the same file drawn as the app draws it offers them', async () => {
    await draw({ id: 'unassigned-claims', content: QUEUE });
    expect(
      list()
        .rowActions()
        ['c1']?.map((entry) => entry.id),
    ).toEqual(['app.rowActions.delete']);
    fixture.destroy();

    await draw({ id: 'unassigned-claims', content: QUEUE, readOnly: true });
    expect(list().rowActions()['c1'] ?? []).toEqual([]);
  });

  it('lets no row be selected and offers no bulk action read-only, where the app would', async () => {
    const selection = TestBed.inject(SelectionService);
    await draw({ id: 'unassigned-claims', content: QUEUE });
    expect(list().selectable()).toBe(true);
    expect(selection.offeredBulkActions()).toEqual(['app.bulkActions.delete']);
    fixture.destroy();

    // Read-only, the app's selection bar is left as the page around the preview has it.
    selection.offeredBulkActions.set(['app.bulkActions.downloadZip']);
    await draw({ id: 'unassigned-claims', content: QUEUE, readOnly: true });
    expect(list().selectable()).toBe(false);
    expect(selection.offeredBulkActions()).toEqual(['app.bulkActions.downloadZip']);
    fixture.destroy();
    expect(selection.offeredBulkActions()).toEqual(['app.bulkActions.downloadZip']);
  });

  it("leaves the app's selection alone read-only when a facet is chosen, where the app clears it", async () => {
    const faceted = { ...QUEUE, facets: [{ aggregate: 'claim_type_agg', label: 'Claim type' }] };
    const withBuckets: PageProviderResults = {
      ...results([claim(1)]),
      aggregations: {
        claim_type_agg: { type: 'terms', buckets: [{ key: 'medical', docCount: 1 }] },
      },
    };
    const selection = TestBed.inject(SelectionService);
    const tick = async (): Promise<void> => {
      const box = host().querySelector<HTMLInputElement>(
        '.queue-facet[data-aggregate="claim_type_agg"] input',
      );
      if (!box) throw new Error('no bucket drawn');
      box.click();
      await settle();
    };
    await draw({ id: 'unassigned-claims', content: faceted }, withBuckets);
    selection.toggle('elsewhere', 'Elsewhere', null, 'File');
    await tick();
    expect(selection.selectedCount()).toBe(0);
    fixture.destroy();

    await draw({ id: 'unassigned-claims', content: faceted, readOnly: true }, withBuckets);
    selection.toggle('elsewhere', 'Elsewhere', null, 'File');
    await tick();
    expect(lastRequest()[1].aggregates).toEqual({ claim_type_agg: ['medical'] });
    expect(selection.selectedCount()).toBe(1);
  });

  it('offers no action over the whole query read-only, with rows selected elsewhere in the app', async () => {
    const selection = TestBed.inject(SelectionService);
    await draw({ id: 'unassigned-claims', content: QUEUE });
    selection.toggle('c1', 'Claim 1', null, 'File');
    await settle();
    expect(host().querySelector('.queue-whole-query')).not.toBeNull();
    fixture.destroy();

    await draw({ id: 'unassigned-claims', content: QUEUE, readOnly: true });
    expect(selection.selectedCount()).toBe(1);
    expect(host().querySelector('.queue-whole-query')).toBeNull();
  });
});
