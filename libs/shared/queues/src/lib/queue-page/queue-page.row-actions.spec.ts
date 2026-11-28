import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { DocumentLayoutService, RECORD_PAGE_TODAY } from '@agentic-ui/shared/document-layouts';
import { AppConfigService } from '@nuxeo/satori-platform/app-config';
import {
  NxsDocumentListComponent,
  NxsRenameDialogComponent,
  NxsToastService,
  provideNxsComponents,
} from '@nuxeo/satori-platform/components';
import {
  DOCUMENT_RULE_EVALUATORS,
  EXTENSION_SLOTS,
  ExtensionRuleContextService,
  PACKAGED_BULK_ACTIONS,
  PACKAGED_ROW_ACTIONS,
  provideSatoriExtensions,
} from '@nuxeo/satori-platform/extensions';
import {
  BrowseService,
  DocumentDetailService,
  PageProviderService,
  SelectionService,
  type NuxeoDocument,
  type PageProviderRequest,
  type PageProviderResults,
} from '@nuxeo/satori-platform/nuxeo-client';
import { ConfirmDialogComponent, providePackagedRowActions } from '@nuxeo/satori-platform/ui';
import { Subject, of, type Observable } from 'rxjs';
import { vi } from 'vitest';

import { QueueService, type QueueLoad } from '../queue.service';
import { QueuePageComponent } from './queue-page';

/**
 * A queue's rows and the platform's row actions, registered as the app registers them: once, by
 * `providePackagedRowActions()`, with no browse and no record page anywhere.
 */

const ROW_ACTIONS = [
  'app.rowActions.download',
  'app.rowActions.rename',
  'app.rowActions.copyTo',
  'app.rowActions.moveTo',
  'app.rowActions.delete',
];

const QUEUE = {
  version: 2,
  label: 'Unassigned claims',
  pageProvider: 'payers_unassigned_claims',
  parameters: ['$currentRepository'],
  columns: ['claim:number'],
  pageSize: 25,
  facets: [{ aggregate: 'claim_type_agg', label: 'Claim type' }],
  rowActions: ROW_ACTIONS,
  bulkActions: ['app.bulkActions.delete'],
};

/** A claim with its scanned form, which the user may read, change and remove. */
const claim = (n: number): NuxeoDocument => ({
  uid: `c${n}`,
  title: `Claim ${n}`,
  type: 'File',
  path: `/claims/2026/c${n}`,
  lastModified: '2026-11-01T00:00:00.000Z',
  properties: {
    'claim:number': `CLM-${n}`,
    'file:content': { name: `claim-${n}.pdf`, 'mime-type': 'application/pdf' },
  },
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
  aggregations: {
    claim_type_agg: {
      type: 'terms',
      buckets: [
        { key: 'medical', docCount: 12 },
        { key: 'dental', docCount: 3 },
      ],
    },
  },
});

describe('QueuePageComponent — the platform row actions', () => {
  let fixture: ComponentFixture<QueuePageComponent>;
  let pages: Subject<PageProviderResults>[];
  let dialogResult: unknown;
  const execute = vi.fn();
  const dialogOpen = vi.fn();
  const toast = { show: vi.fn(), error: vi.fn() };
  const detail = {
    fetchBlob: vi.fn(() => of(new Blob(['x']))),
    trashDocument: vi.fn(() => of(undefined)),
  };
  const browse = {
    copyDocuments: vi.fn(() => of([claim(1)])),
    moveDocuments: vi.fn(() => of([claim(1)])),
    hasChildCollections: vi.fn(() => of(false)),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    pages = [];
    dialogResult = undefined;
    execute.mockImplementation(() => {
      const next = new Subject<PageProviderResults>();
      pages.push(next);
      return next;
    });
    dialogOpen.mockImplementation(() => ({ afterClosed: () => of(dialogResult) }));
    TestBed.overrideProvider(MatDialog, { useValue: { open: dialogOpen } });
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
          actions: { 'app.bulkActions.delete': { execute: () => undefined } },
        }),
        providePackagedRowActions(),
        // The row actions' messages go through an environment toast when there is one.
        { provide: NxsToastService, useValue: toast },
        { provide: DocumentDetailService, useValue: detail },
        { provide: BrowseService, useValue: browse },
        {
          provide: QueueService,
          useValue: {
            load: (): Observable<QueueLoad> => of({ kind: 'file', content: QUEUE }),
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
    fixture = TestBed.createComponent(QueuePageComponent);
    fixture.componentRef.setInput('id', 'unassigned-claims');
    await settle();
    await answer([claim(1), claim(2)]);
  });

  afterEach(() => {
    fixture.destroy();
    vi.restoreAllMocks();
  });

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function answer(entries: NuxeoDocument[]): Promise<void> {
    const last = pages[pages.length - 1];
    last.next(results(entries));
    last.complete();
    await settle();
  }

  const list = (): NxsDocumentListComponent =>
    fixture.debugElement.query(By.directive(NxsDocumentListComponent))
      .componentInstance as NxsDocumentListComponent;
  const lastRequest = (): PageProviderRequest =>
    (execute.mock.calls[execute.mock.calls.length - 1] as [string, PageProviderRequest])[1];

  async function choose(id: string, row: NuxeoDocument): Promise<void> {
    list().rowAction.emit({ action: { id, label: id }, document: row });
    await settle();
  }

  it("offers each row the platform's five row actions, while their rules pass", () => {
    expect(
      list()
        .rowActions()
        ['c1']?.map((entry) => entry.id),
    ).toEqual(ROW_ACTIONS);
  });

  it('renames a row, then asks for the queue again with the bucket chosen', async () => {
    const box = fixture.nativeElement.querySelector(
      '.queue-facet[data-aggregate="claim_type_agg"] nxs-checkbox input',
    ) as HTMLInputElement;
    box.click();
    await settle();
    await answer([claim(1)]);
    const asked = execute.mock.calls.length;

    dialogResult = { ...claim(1), title: 'Claim one' };
    await choose('app.rowActions.rename', claim(1));

    expect(dialogOpen).toHaveBeenCalledWith(NxsRenameDialogComponent, {
      data: { documentId: 'c1', title: 'Claim 1' },
    });
    expect(execute).toHaveBeenCalledTimes(asked + 1);
    expect(lastRequest().aggregates).toEqual({ claim_type_agg: ['medical'] });
  });

  it('trashes a selected row, takes it out of the selection, and asks for the queue again', async () => {
    const selection = TestBed.inject(SelectionService);
    // As ticking both rows' boxes does: the list's two-way selection, which the queue keeps in the app's.
    list().selectedIds.set(['c1', 'c2']);
    await settle();
    expect(selection.selectedCount()).toBe(2);
    const asked = execute.mock.calls.length;

    dialogResult = true;
    await choose('app.rowActions.delete', claim(1));

    expect(dialogOpen.mock.calls[0][0]).toBe(ConfirmDialogComponent);
    expect(detail.trashDocument).toHaveBeenCalledWith('c1');
    expect([...selection.selectedIds()]).toEqual(['c2']);
    expect(execute).toHaveBeenCalledTimes(asked + 1);
  });
});
