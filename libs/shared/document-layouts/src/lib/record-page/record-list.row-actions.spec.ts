import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { AppConfigService } from '@nuxeo/satori-platform/app-config';
import {
  NxsDocumentListComponent,
  NxsFolderPickerDialogComponent,
  NxsRenameDialogComponent,
  NxsToastService,
  provideNxsComponents,
} from '@nuxeo/satori-platform/components';
import {
  EXTENSION_SLOTS,
  ExtensionActionRegistry,
  PACKAGED_ROW_ACTIONS,
  provideSatoriExtensions,
} from '@nuxeo/satori-platform/extensions';
import {
  BrowseService,
  DocumentDetailService,
  type NuxeoDocument,
  type NuxeoDocumentList,
  PageProviderService,
} from '@nuxeo/satori-platform/nuxeo-client';
import { ConfirmDialogComponent, providePackagedRowActions } from '@nuxeo/satori-platform/ui';
import { Subject, of } from 'rxjs';

import { DocumentLayoutService } from '../document-layout.service';
import type { LayoutFieldType } from '../layout.model';
import type { RecordListEntry, RecordPropertyField } from './record-layout';
import { RECORD_PAGE_TIME_ZONE, RECORD_PAGE_TODAY } from './record-clock';
import { RecordListComponent } from './record-list';

/**
 * A record page's list of related records, with the platform's row actions registered as the app
 * registers them: once, by `providePackagedRowActions()`, with no browse on the page.
 */

const ROW_ACTIONS = [
  'app.rowActions.download',
  'app.rowActions.rename',
  'app.rowActions.copyTo',
  'app.rowActions.moveTo',
  'app.rowActions.delete',
];

const title: RecordPropertyField = {
  kind: 'property',
  place: 'cards[1].related.columns[dc:title]',
  xpath: 'dc:title',
  label: { keys: [], fallback: 'Title' },
  widget: null,
  parameters: {},
  visibleWhen: null,
};

const CLAIMS: RecordListEntry = {
  pageProvider: 'member_claims',
  parameters: [{ field: 'ecm:uuid' }],
  columns: [title],
  sort: [],
  pageSize: 10,
  rowActions: ROW_ACTIONS,
};

/** A claim with its scanned form: the user may read, change and remove it. */
const claim: NuxeoDocument = {
  uid: 'c1',
  title: 'Claim 1',
  type: 'File',
  path: '/claims/2026/c1',
  lastModified: '2026-11-01T00:00:00.000Z',
  properties: {
    'dc:title': 'Claim 1',
    'file:content': { name: 'claim-1.pdf', 'mime-type': 'application/pdf' },
  },
  contextParameters: { permissions: ['Read', 'Write', 'Remove'] },
};

/** Its reader may only read it. */
const readOnly: NuxeoDocument = {
  ...claim,
  uid: 'c2',
  title: 'Claim 2',
  path: '/claims/2026/c2',
  contextParameters: { permissions: ['Read'] },
};

const page = (entries: NuxeoDocument[]): NuxeoDocumentList => ({
  entries,
  totalSize: entries.length,
  currentPageSize: entries.length,
  currentPageIndex: 0,
  numberOfPages: 1,
  isNextPageAvailable: false,
});

describe('RecordListComponent — the platform row actions', () => {
  let fixture: ComponentFixture<RecordListComponent>;
  let pages: Subject<NuxeoDocumentList>[];
  let dialogResult: unknown;
  const execute = vi.fn();
  const dialogOpen = vi.fn();
  const toast = { show: vi.fn(), error: vi.fn() };
  const detail = {
    fetchBlob: vi.fn(() => of(new Blob(['x']))),
    trashDocument: vi.fn(() => of(undefined)),
    getFullDocument: vi.fn(() => of(claim)),
  };
  const browse = {
    copyDocuments: vi.fn(() => of([claim])),
    moveDocuments: vi.fn(() => of([claim])),
    hasChildCollections: vi.fn(() => of(false)),
  };
  const destination = { uid: 'dest', path: '/claims/closed', title: 'Closed' };

  beforeEach(async () => {
    vi.clearAllMocks();
    pages = [];
    dialogResult = undefined;
    execute.mockImplementation(() => {
      const next = new Subject<NuxeoDocumentList>();
      pages.push(next);
      return next;
    });
    dialogOpen.mockImplementation(() => ({ afterClosed: () => of(dialogResult) }));
    TestBed.overrideProvider(MatDialog, { useValue: { open: dialogOpen } });
    TestBed.configureTestingModule({
      imports: [RecordListComponent, MatIconTestingModule],
      providers: [
        provideNxsComponents(),
        provideRouter([]),
        { provide: AppConfigService, useValue: { manifest: signal({ extensionLayers: [] }) } },
        provideSatoriExtensions({ slots: { [EXTENSION_SLOTS.rowActions]: PACKAGED_ROW_ACTIONS } }),
        providePackagedRowActions(),
        // The row actions' messages go through an environment toast when there is one.
        { provide: NxsToastService, useValue: toast },
        { provide: PageProviderService, useValue: { execute } },
        { provide: DocumentDetailService, useValue: detail },
        { provide: BrowseService, useValue: browse },
        {
          provide: DocumentLayoutService,
          useValue: {
            rowPropertiesOf: () =>
              of(new Map<string, LayoutFieldType>([['dc:title', { type: 'string' }]])),
            vocabularyLabel: () => of(null),
            principalLabel: () => of(null),
          },
        },
        { provide: RECORD_PAGE_TODAY, useValue: () => new Date('2026-11-23T12:00:00Z') },
        { provide: RECORD_PAGE_TIME_ZONE, useValue: '+0000' },
      ],
    });
    fixture = TestBed.createComponent(RecordListComponent);
    fixture.componentRef.setInput('list', CLAIMS);
    fixture.componentRef.setInput('parameters', ['m1']);
    fixture.componentRef.setInput('label', 'Claims');
    await settle();
    await answer([claim, readOnly]);
  });

  afterEach(() => fixture.destroy());

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function answer(rows: NuxeoDocument[]): Promise<void> {
    pages[pages.length - 1].next(page(rows));
    pages[pages.length - 1].complete();
    await settle();
  }

  const list = (): NxsDocumentListComponent =>
    fixture.debugElement.query(By.directive(NxsDocumentListComponent))
      .componentInstance as NxsDocumentListComponent;

  const menu = (uid: string): string[] => (list().rowActions()[uid] ?? []).map((entry) => entry.id);

  /** Chooses the entry from the row's menu, as a click on it does, and lets the list follow. */
  async function choose(id: string, row: NuxeoDocument = claim): Promise<void> {
    list().rowAction.emit({ action: { id, label: id }, document: row });
    await settle();
  }

  it('offers Download, Rename, Copy to, Move to and Delete, each while its rule passes for the row', () => {
    expect(menu('c1')).toEqual(ROW_ACTIONS);
    // The same rules as browse's: a reader may download the file and copy it, nothing more.
    expect(menu('c2')).toEqual(['app.rowActions.download', 'app.rowActions.copyTo']);
  });

  it('downloads the row’s file under its own name, and leaves the list as it is', async () => {
    const originals = {
      click: HTMLAnchorElement.prototype.click,
      create: URL.createObjectURL,
      revoke: URL.revokeObjectURL,
    };
    const downloads: string[] = [];
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    };
    URL.createObjectURL = () => 'blob:claim';
    URL.revokeObjectURL = () => undefined;
    try {
      await choose('app.rowActions.download');
    } finally {
      HTMLAnchorElement.prototype.click = originals.click;
      URL.createObjectURL = originals.create;
      URL.revokeObjectURL = originals.revoke;
    }
    expect(detail.fetchBlob).toHaveBeenCalledWith('c1', { clientReason: 'download' });
    expect(downloads).toEqual(['claim-1.pdf']);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('renames the row, then asks for the list again', async () => {
    dialogResult = { ...claim, title: 'Claim one' };
    await choose('app.rowActions.rename');
    expect(dialogOpen).toHaveBeenCalledWith(NxsRenameDialogComponent, {
      data: { documentId: 'c1', title: 'Claim 1' },
    });
    expect(toast.show).toHaveBeenCalledWith('Renamed to "Claim one"');
    expect(execute).toHaveBeenCalledTimes(2);
    await answer([{ ...claim, title: 'Claim one' }, readOnly]);
    expect(list().documents()[0].title).toBe('Claim one');
  });

  it('copies the row to the folder chosen, from the folder it is in, then asks again', async () => {
    dialogResult = destination;
    await choose('app.rowActions.copyTo');
    expect(dialogOpen).toHaveBeenCalledWith(NxsFolderPickerDialogComponent, {
      data: expect.objectContaining({ initialPath: '/claims/2026', currentParentPath: undefined }),
    });
    expect(browse.copyDocuments).toHaveBeenCalledWith(['c1'], 'dest');
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('moves the row to the folder chosen, not offering the one it is in, then asks again', async () => {
    dialogResult = destination;
    await choose('app.rowActions.moveTo');
    expect(dialogOpen.mock.calls[0][0]).toBe(NxsFolderPickerDialogComponent);
    expect(dialogOpen.mock.calls[0][1].data.currentParentPath).toBe('/claims/2026');
    expect(browse.moveDocuments).toHaveBeenCalledWith(['c1'], 'dest');
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('asks, then moves the row to the trash, then asks again', async () => {
    dialogResult = true;
    await choose('app.rowActions.delete');
    expect(dialogOpen.mock.calls[0][0]).toBe(ConfirmDialogComponent);
    expect(detail.trashDocument).toHaveBeenCalledWith('c1');
    expect(execute).toHaveBeenCalledTimes(2);
    await answer([readOnly]);
    expect(
      list()
        .documents()
        .map((row) => row.uid),
    ).toEqual(['c2']);
  });

  it('asks nothing again when an action is cancelled', async () => {
    await choose('app.rowActions.rename');
    await choose('app.rowActions.moveTo');
    dialogResult = false;
    await choose('app.rowActions.delete');
    expect(dialogOpen).toHaveBeenCalledTimes(3);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('runs no action its rule refuses for the row', async () => {
    await choose('app.rowActions.delete', readOnly);
    expect(dialogOpen).not.toHaveBeenCalled();
    expect(detail.trashDocument).not.toHaveBeenCalled();
  });

  it("runs a customer's handler for a platform id instead of the platform's", async () => {
    const customer = vi.fn();
    TestBed.inject(ExtensionActionRegistry).register({
      'app.rowActions.rename': { execute: customer },
    });
    await choose('app.rowActions.rename');
    expect(customer).toHaveBeenCalledWith(expect.objectContaining({ document: claim }));
    expect(dialogOpen).not.toHaveBeenCalled();
  });
});
