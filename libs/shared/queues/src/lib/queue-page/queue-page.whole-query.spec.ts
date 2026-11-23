import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { DocumentLayoutService, RECORD_PAGE_TODAY } from '@agentic-ui/shared/document-layouts';
import { AppConfigService } from '@nuxeo/satori-platform/app-config';
import {
  NxsConfirmDialogComponent,
  NxsDocumentListComponent,
  provideNxsComponents,
  type NxsConfirmDialogData,
} from '@nuxeo/satori-platform/components';
import {
  DOCUMENT_RULE_EVALUATORS,
  EXTENSION_SLOTS,
  ExtensionActionRegistry,
  ExtensionRuleContextService,
  PACKAGED_BULK_ACTIONS,
  provideSatoriExtensions,
  type ExtensionActionDescriptor,
} from '@nuxeo/satori-platform/extensions';
import {
  BulkCommandService,
  PageProviderService,
  SelectionService,
  type BulkCommandStatus,
  type NuxeoDocument,
  type PageProviderResults,
} from '@nuxeo/satori-platform/nuxeo-client';
import { Subject, of, throwError, type Observable } from 'rxjs';
import { vi } from 'vitest';

import { QueueService, type QueueLoad } from '../queue.service';
import { QUEUE_WHOLE_QUERY_TIMING } from '../whole-query-run';
import { QueuePageComponent } from './queue-page';

const QUEUE = {
  version: 2,
  label: 'Unassigned claims',
  pageProvider: 'payers_unassigned_claims',
  parameters: ['$currentUser'],
  columns: ['claim:number'],
  pageSize: 2,
  facets: [{ aggregate: 'claim_type_agg', label: 'Claim type' }],
  bulkActions: ['app.bulkActions.delete', 'app.bulkActions.downloadZip'],
};

const ID = '1e0ad81f-3592-4ad2-9878-023539dd2733';

const claim = (n: number): NuxeoDocument => ({
  uid: `c${n}`,
  title: `Claim ${n}`,
  type: 'Claim',
  path: `/claims/c${n}`,
  lastModified: '2026-11-01T00:00:00.000Z',
  properties: { 'claim:number': `CLM-${n}` },
});

const at = (
  state: BulkCommandStatus['state'],
  processed: number,
  total: number,
  extra: Partial<BulkCommandStatus> = {},
): BulkCommandStatus => ({
  commandId: ID,
  state,
  processed,
  total,
  errorCount: 0,
  skipCount: 0,
  errorMessage: null,
  ended: state === 'COMPLETED',
  result: null,
  ...extra,
});

describe('QueuePageComponent, over the whole query', () => {
  let fixture: ComponentFixture<QueuePageComponent>;
  let files: Record<string, QueueLoad>;
  let pages: Subject<PageProviderResults>[];
  let execute: ReturnType<typeof vi.fn>;
  let warnings: string[];
  let dialogs: NxsConfirmDialogData[];
  let agree: boolean;
  let submit: () => Observable<BulkCommandStatus>;
  let reads: Subject<BulkCommandStatus>[];
  let calls: string[];
  let aborted: BulkCommandStatus;

  function create(bulkActions: readonly ExtensionActionDescriptor[] = PACKAGED_BULK_ACTIONS): void {
    TestBed.configureTestingModule({
      imports: [QueuePageComponent, MatIconTestingModule],
      providers: [
        provideNxsComponents(),
        provideRouter([]),
        { provide: AppConfigService, useValue: { manifest: signal({ extensionLayers: [] }) } },
        provideSatoriExtensions({
          slots: { [EXTENSION_SLOTS['bulk-actions']]: bulkActions },
          rules: DOCUMENT_RULE_EVALUATORS,
        }),
        {
          provide: QueueService,
          useValue: { load: (id: string) => of(files[id] ?? { kind: 'none' }) },
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
        {
          provide: MatDialog,
          useValue: {
            open: (component: unknown, config: { data: NxsConfirmDialogData }) => {
              expect(component).toBe(NxsConfirmDialogComponent);
              dialogs.push(config.data);
              return { afterClosed: () => of(agree ? true : undefined) };
            },
          },
        },
        {
          provide: BulkCommandService,
          useValue: {
            runOverPageProvider: (
              name: string,
              query: { parameters?: readonly string[] },
              action: string,
              parameters: unknown,
            ) => {
              calls.push(
                `run ${name} ${JSON.stringify(query)} ${action} ${JSON.stringify(parameters)}`,
              );
              return submit();
            },
            status: () => {
              calls.push('status');
              const read = new Subject<BulkCommandStatus>();
              reads.push(read);
              return read;
            },
            abort: () => {
              calls.push('abort');
              return of(aborted);
            },
          },
        },
        {
          provide: QUEUE_WHOLE_QUERY_TIMING,
          useValue: { pollMs: 0, countPollMs: 0, countReads: 25, failures: 2, settle: 2 },
        },
      ],
    });
    TestBed.inject(ExtensionActionRegistry).register(
      Object.fromEntries(
        PACKAGED_BULK_ACTIONS.map((action) => [action.id, { execute: () => undefined }]),
      ),
    );
    TestBed.inject(ExtensionRuleContextService).username.set('ada');
  }

  async function open(): Promise<void> {
    fixture = TestBed.createComponent(QueuePageComponent);
    fixture.componentRef.setInput('id', 'unassigned-claims');
    await settle();
  }

  async function settle(): Promise<void> {
    for (let i = 0; i < 3; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    fixture.detectChanges();
  }

  /** The page the list asked for last, answered: two rows of `total`. */
  async function answer(total: number, extra: Partial<PageProviderResults> = {}): Promise<void> {
    const last = pages[pages.length - 1];
    last.next({
      entries: [claim(1), claim(2)],
      totalSize: total,
      resultsCount: total,
      currentPageSize: 2,
      currentPageIndex: 0,
      numberOfPages: Math.ceil(total / 2),
      isNextPageAvailable: total > 2,
      aggregations: {
        claim_type_agg: { type: 'terms', buckets: [{ key: 'medical', docCount: total }] },
      },
      ...extra,
    });
    last.complete();
    await settle();
  }

  /** The server's next answer to a status read. */
  async function respond(status: BulkCommandStatus): Promise<void> {
    await settle();
    const read = reads.shift();
    expect(read, 'a status read was asked for').toBeDefined();
    read?.next(status);
    read?.complete();
    await settle();
  }

  const page = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const notice = (): string =>
    (page().querySelector('.queue-whole-query__notice .nxs-banner__message')?.textContent ?? '')
      .replace(/\s+/g, ' ')
      .trim();
  const buttons = (): string[] =>
    [...page().querySelectorAll('.queue-whole-query__notice button')].map((button) =>
      (button.textContent ?? '').replace(/\s+/g, ' ').trim(),
    );
  const press = async (selector: string): Promise<void> => {
    const button = page().querySelector<HTMLButtonElement>(
      `.queue-whole-query__notice ${selector}`,
    );
    expect(button, `${selector} is drawn`).not.toBeNull();
    button?.click();
    await settle();
  };
  const progress = (): HTMLProgressElement | null =>
    page().querySelector('progress.queue-whole-query__progress');
  const list = (): NxsDocumentListComponent =>
    fixture.debugElement.query(By.directive(NxsDocumentListComponent))
      .componentInstance as NxsDocumentListComponent;
  const selectRow = async (): Promise<void> => {
    list().selectedIds.set(['c1']);
    await settle();
  };

  beforeEach(() => {
    files = { 'unassigned-claims': { kind: 'file', content: QUEUE } };
    pages = [];
    execute = vi.fn(() => {
      const next = new Subject<PageProviderResults>();
      pages.push(next);
      return next;
    });
    warnings = [];
    vi.spyOn(console, 'warn').mockImplementation((message: unknown) =>
      warnings.push(String(message)),
    );
    dialogs = [];
    agree = true;
    submit = () => of(at('SCHEDULED', 0, 0));
    reads = [];
    calls = [];
    aborted = at('ABORTED', 0, 0, { ended: true });
  });

  afterEach(() => {
    fixture?.destroy();
    vi.restoreAllMocks();
  });

  it('offers every result of the query once a row is selected, naming the total', async () => {
    create();
    await open();
    await answer(120);
    expect(notice()).toBe('');
    await selectRow();
    expect(notice()).toBe('This queue has 120 results.');
    expect(buttons()).toEqual(['Select all 120 results']);
    await press('.queue-whole-query__select-all');
    // The rows' selection gives way to every result's, and no row can be selected meanwhile.
    expect(TestBed.inject(SelectionService).selectedCount()).toBe(0);
    expect(list().selectable()).toBe(false);
    expect(notice()).toBe('All 120 results of this queue are selected.');
    // Only Delete maps to an action on the server: Download works on documents in hand.
    expect(buttons()).toEqual(['Delete selected', 'Clear selection']);
    await press('.queue-whole-query__clear');
    expect(notice()).toBe('');
    expect(list().selectable()).toBe(true);
  });

  it('confirms, naming the number of records, and runs nothing when the person cancels', async () => {
    create();
    await open();
    await answer(120);
    await selectRow();
    await press('.queue-whole-query__select-all');
    agree = false;
    await press('.queue-whole-query__run');
    expect(dialogs).toHaveLength(1);
    expect(calls).toEqual([]);
    expect(notice()).toBe('All 120 results of this queue are selected.');
  });

  it('runs on the server with the queue parameters and no bucket, shows progress, reports and reads the list again', async () => {
    create();
    const translate = TestBed.inject((await import('@ngx-translate/core')).TranslateService);
    const instant = vi.spyOn(translate, 'instant');
    await open();
    await answer(120);
    await selectRow();
    await press('.queue-whole-query__select-all');
    await press('.queue-whole-query__run');
    expect(instant).toHaveBeenCalledWith('queues.whole-query.confirm-message', {
      action: 'Delete selected',
      count: '120',
    });
    expect(calls[0]).toBe(
      'run payers_unassigned_claims {"parameters":["$currentUser"],"limit":121} trash {"value":true}',
    );
    expect(notice()).toBe('Delete selected: starting');
    expect(progress()?.hasAttribute('value')).toBe(false);
    await respond(at('RUNNING', 60, 120));
    expect(notice()).toBe('Delete selected: 60 of 120 records');
    expect(progress()?.value).toBe(60);
    expect(progress()?.max).toBe(120);
    expect(buttons()).toEqual(['Stop']);
    const asked = execute.mock.calls.length;
    await respond(at('COMPLETED', 120, 120));
    expect(notice()).toBe('Delete selected: done for 120 records.');
    expect(progress()).toBeNull();
    expect(instant).toHaveBeenCalledWith(
      'queues.whole-query.done',
      expect.objectContaining({ action: 'Delete selected', processed: '120' }),
    );
    // The list is read again: the records have changed.
    expect(execute.mock.calls.length).toBe(asked + 1);
    await answer(0);
    await press('.queue-whole-query__dismiss');
    expect(notice()).toBe('');
  });

  it('stops the command when the server finds more records than were agreed to', async () => {
    create();
    await open();
    await answer(120);
    await selectRow();
    await press('.queue-whole-query__select-all');
    await press('.queue-whole-query__run');
    aborted = at('ABORTED', 2100, 2314, { ended: true });
    await respond(at('RUNNING', 100, 2314));
    expect(calls).toContain('abort');
    expect(notice()).toBe(
      'Delete selected stopped: the query now holds more records than the 120 you agreed to. The server processed 2,100, and goes no further than one more than you agreed to.',
    );
  });

  it('stops when the person asks, and says so', async () => {
    create();
    await open();
    await answer(120);
    await selectRow();
    await press('.queue-whole-query__select-all');
    await press('.queue-whole-query__run');
    await respond(at('RUNNING', 10, 120));
    aborted = at('ABORTED', 12, 120, { ended: true });
    await press('.queue-whole-query__stop');
    // A read already in flight answers; then the stop is taken.
    await respond(at('RUNNING', 11, 120));
    expect(calls).toContain('abort');
    expect(notice()).toBe(
      'Delete selected stopped. 12 of 120 records were processed before it stopped.',
    );
  });

  it('says so plainly when it was stopped before the server had counted the records', async () => {
    create();
    await open();
    await answer(120);
    await selectRow();
    await press('.queue-whole-query__select-all');
    await press('.queue-whole-query__run');
    await press('.queue-whole-query__stop');
    expect(buttons()).toEqual(['Stopping']);
    await respond(at('SCHEDULED', 0, 0));
    expect(calls).toContain('abort');
    expect(notice()).toBe(
      'Delete selected stopped before the server had counted the records. None were processed.',
    );
  });

  it('says plainly when the server refuses the command, and reads nothing again', async () => {
    create();
    submit = () => throwError(() => new HttpErrorResponse({ status: 403 }));
    await open();
    await answer(120);
    await selectRow();
    await press('.queue-whole-query__select-all');
    const asked = execute.mock.calls.length;
    await press('.queue-whole-query__run');
    expect(notice()).toBe(
      'Delete selected did not run: the server does not let you run it over a whole query.',
    );
    expect(execute.mock.calls.length).toBe(asked);
    expect(warnings).toContainEqual(
      expect.stringContaining('the bulk command was not taken: HTTP 403'),
    );
  });

  it('does not offer every result while a bucket is chosen: the server would not keep it', async () => {
    create();
    await open();
    await answer(120);
    const box = page().querySelector('.queue-facet mat-checkbox input') as HTMLInputElement;
    box.click();
    await settle();
    await answer(40);
    await selectRow();
    expect(notice()).toBe(
      'Every result cannot be selected while a filter is chosen. Clear the filters to select them all.',
    );
    expect(buttons()).toEqual([]);
  });

  it('does not offer every result when the page provider does not count them', async () => {
    create();
    await open();
    await answer(120, { totalSize: -1, resultsCount: -2 });
    await selectRow();
    expect(notice()).toBe('');
    expect(warnings).toContainEqual(
      expect.stringContaining(
        'every result cannot be selected: the page provider does not say how many',
      ),
    );
  });

  it('does not offer it for a queue whose bulk actions cannot run over a whole query', async () => {
    files['unassigned-claims'] = {
      kind: 'file',
      content: { ...QUEUE, bulkActions: ['app.bulkActions.downloadZip'] },
    };
    create();
    await open();
    await answer(120);
    await selectRow();
    expect(notice()).toBe('');
  });

  it("does not offer Delete over the whole query when its descriptor runs another action's handler", async () => {
    create(
      PACKAGED_BULK_ACTIONS.map((action) =>
        action.id === 'app.bulkActions.delete'
          ? { ...action, action: 'app.bulkActions.downloadZip' }
          : action,
      ),
    );
    await open();
    await answer(120);
    await selectRow();
    expect(notice()).toBe('');
    expect(warnings).toContainEqual(
      expect.stringContaining(
        'bulkActions "app.bulkActions.delete" is not offered over the whole query: its descriptor runs "app.bulkActions.downloadZip"',
      ),
    );
  });
});
