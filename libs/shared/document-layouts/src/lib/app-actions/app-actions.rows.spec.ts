import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { AppConfigService } from '@nuxeo/satori-platform/app-config';
import {
  NxsDocumentListComponent,
  NxsToastService,
  provideNxsComponents,
} from '@nuxeo/satori-platform/components';
import {
  DOCUMENT_RULE_EVALUATORS,
  provideSatoriExtensions,
} from '@nuxeo/satori-platform/extensions';
import {
  type NuxeoDocument,
  type NuxeoDocumentList,
  NuxeoApiBase,
  PageProviderService,
} from '@nuxeo/satori-platform/nuxeo-client';
import { Subject, of } from 'rxjs';

import { DocumentLayoutService } from '../document-layout.service';
import type { LayoutFieldType } from '../layout.model';
import type { RecordListEntry, RecordPropertyField } from '../record-page/record-layout';
import { RECORD_PAGE_TIME_ZONE, RECORD_PAGE_TODAY } from '../record-page/record-clock';
import { RecordListComponent } from '../record-page/record-list';
import { AppActionDialogComponent } from './app-action-dialog';
import { AppActionsService } from './app-actions.service';

// An app's operation button on a list's rows, a queue's or a related list's, as the app registers
// it at startup: offered on the rows its rule passes for, enabled by its enabled rule, and chosen
// on a row, it opens its confirmation for that row.

const REQUEST = 'payers.claim.requestRecords';

const ACTIONS = {
  version: 2,
  actions: [
    {
      id: REQUEST,
      label: 'Request medical records',
      on: ['row'],
      visibleWhen: { type: 'app.rules.inState', parameters: ['inReview'] },
      enabledWhen: 'app.rules.canWrite',
      operation: 'Payers.RequestMedicalRecords',
    },
  ],
};

const title: RecordPropertyField = {
  kind: 'property',
  place: 'columns[0]',
  xpath: 'dc:title',
  label: { keys: [], fallback: 'Title' },
  widget: null,
  parameters: {},
  visibleWhen: null,
};

const CLAIMS: RecordListEntry = {
  pageProvider: 'payers_my_claims',
  parameters: [],
  columns: [title],
  sort: [],
  pageSize: 10,
  rowActions: [REQUEST],
};

const row = (uid: string, state: string, permissions: string[]): NuxeoDocument => ({
  uid,
  title: uid,
  type: 'Claim',
  path: `/claims/${uid}`,
  lastModified: '2026-11-25T00:00:00.000Z',
  state,
  properties: { 'dc:title': uid },
  contextParameters: { permissions },
});

const inReview = row('c1', 'inReview', ['Read', 'Write']);
const readOnly = row('c2', 'inReview', ['Read']);
const approved = row('c3', 'approved', ['Read', 'Write']);

describe('An app’s operation button on a list’s rows', () => {
  let fixture: ComponentFixture<RecordListComponent>;
  let pages: Subject<NuxeoDocumentList>[];
  const dialogOpen = vi.fn();

  beforeEach(async () => {
    vi.clearAllMocks();
    pages = [];
    dialogOpen.mockImplementation(() => ({ afterClosed: () => of(undefined) }));
    TestBed.overrideProvider(MatDialog, { useValue: { open: dialogOpen } });
    TestBed.configureTestingModule({
      imports: [RecordListComponent, MatIconTestingModule],
      providers: [
        provideNxsComponents(),
        provideRouter([]),
        { provide: AppConfigService, useValue: { manifest: signal({ extensionLayers: [] }) } },
        provideSatoriExtensions({ rules: DOCUMENT_RULE_EVALUATORS }),
        { provide: NxsToastService, useValue: { show: vi.fn(), error: vi.fn() } },
        { provide: NuxeoApiBase, useValue: {} },
        {
          provide: PageProviderService,
          useValue: {
            execute: () => {
              const next = new Subject<NuxeoDocumentList>();
              pages.push(next);
              return next;
            },
          },
        },
        {
          provide: DocumentLayoutService,
          useValue: {
            rowPropertiesOf: () =>
              of(new Map<string, LayoutFieldType>([['dc:title', { type: 'string' }]])),
            vocabularyLabel: () => of(null),
            principalLabel: () => of(null),
          },
        },
        { provide: RECORD_PAGE_TODAY, useValue: () => new Date('2026-11-25T12:00:00Z') },
        { provide: RECORD_PAGE_TIME_ZONE, useValue: '+0000' },
      ],
    });
    // At startup, before any list is drawn.
    TestBed.inject(AppActionsService).register('payers-claims', ACTIONS);
    fixture = TestBed.createComponent(RecordListComponent);
    fixture.componentRef.setInput('list', CLAIMS);
    fixture.componentRef.setInput('parameters', []);
    fixture.componentRef.setInput('label', 'My claims');
    await settle();
    pages[0].next({
      entries: [inReview, readOnly, approved],
      totalSize: 3,
      currentPageSize: 3,
      currentPageIndex: 0,
      numberOfPages: 1,
      isNextPageAvailable: false,
    });
    pages[0].complete();
    await settle();
  });

  afterEach(() => fixture.destroy());

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const list = (): NxsDocumentListComponent =>
    fixture.debugElement.query(By.directive(NxsDocumentListComponent))
      .componentInstance as NxsDocumentListComponent;

  it('is offered on the rows its rule passes for, and enabled where its enabled rule does', () => {
    const menus = list().rowActions();
    expect(menus['c1']).toEqual([
      expect.objectContaining({ id: REQUEST, label: 'Request medical records', disabled: false }),
    ]);
    expect(menus['c2']).toEqual([expect.objectContaining({ id: REQUEST, disabled: true })]);
    expect(menus['c3']).toBeUndefined();
  });

  it('opens its confirmation for the row it is chosen on, and for no row its rules refuse', async () => {
    list().rowAction.emit({ action: { id: REQUEST, label: REQUEST }, document: readOnly });
    await settle();
    expect(dialogOpen).not.toHaveBeenCalled();
    list().rowAction.emit({ action: { id: REQUEST, label: REQUEST }, document: inReview });
    await settle();
    expect(dialogOpen).toHaveBeenCalledTimes(1);
    expect(dialogOpen.mock.calls[0][0]).toBe(AppActionDialogComponent);
    expect(dialogOpen.mock.calls[0][1].data.document.uid).toBe('c1');
  });
});
