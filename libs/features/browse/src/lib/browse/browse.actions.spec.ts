import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { testTranslateModule } from '@agentic-ui/testing/i18n';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { Router, provideRouter, withDisabledInitialNavigation } from '@angular/router';
import { EMPTY, Subject, of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { AppConfigService } from '@nuxeo-satori/platform/app-config';
import {
  ExtensionActionRegistry,
  ExtensionRuleContextService,
  type ExtensionActionDescriptor,
} from '@nuxeo-satori/platform/extensions';
import {
  ADMIN_ACCESS_CHECKS,
  BrowseContextService,
  BrowseService,
  CURRENT_USERNAME,
  DirectoryService,
  DocumentDetailService,
  PERMISSION_DENIED_KEY,
  TagService,
  type AuditEntry,
  type DirectoryEntry,
  type NuxeoDocument,
} from '@nuxeo-satori/platform/nuxeo-client';
import type { ExportDialogData } from '@nuxeo-satori/platform/ui';

import { BrowseComponent } from './browse';
import { NxsToastService } from '@nuxeo-satori/platform/components';

/** A complete `NuxeoDocument`, so a fixture states only the fields its test is about. */
function doc(overrides: Partial<NuxeoDocument> & Pick<NuxeoDocument, 'uid'>): NuxeoDocument {
  return {
    title: 'Document',
    type: 'File',
    path: '/default-domain/workspaces/ws-1/document',
    lastModified: '2026-01-01T00:00:00.000Z',
    properties: {},
    ...overrides,
  };
}

/** A complete `AuditEntry`. */
function auditEntry(overrides: Partial<AuditEntry> & Pick<AuditEntry, 'id'>): AuditEntry {
  return {
    category: 'eventDocumentCategory',
    principalName: 'jdoe',
    comment: '',
    docLifeCycle: 'project',
    docPath: '/default-domain/workspaces/ws-1/document',
    docType: 'File',
    docUUID: 'doc-1',
    eventId: 'documentModified',
    repositoryId: 'default',
    eventDate: '2026-01-01T00:00:00.000Z',
    logDate: '2026-01-01T00:00:00.000Z',
    extended: {},
    ...overrides,
  };
}

function directoryEntry(id: string, label: string): DirectoryEntry {
  return {
    id,
    label,
    displayLabel: label,
    ordering: 0,
    obsolete: 0,
    directoryName: 'eventTypes',
  };
}

const folder = doc({
  uid: 'ws-1',
  title: 'Workspace',
  type: 'Workspace',
  path: '/default-domain/workspaces/ws-1',
  facets: ['Folderish'],
  contextParameters: { permissions: ['Read', 'Write', 'AddChildren', 'Remove'] },
});

const emptyAuditLog = {
  entries: [],
  totalSize: 0,
  currentPageSize: 0,
  currentPageIndex: 0,
  numberOfPages: 0,
};

type BrowseReturn<K extends keyof BrowseService> = ReturnType<BrowseService[K]>;
type DetailReturn<K extends keyof DocumentDetailService> = ReturnType<DocumentDetailService[K]>;
type TagReturn<K extends keyof TagService> = ReturnType<TagService[K]>;
type DirectoryReturn<K extends keyof DirectoryService> = ReturnType<DirectoryService[K]>;

const browse = {
  getByPath: vi.fn((): BrowseReturn<'getByPath'> => EMPTY),
  getBrowseFolderContents: vi.fn((): BrowseReturn<'getBrowseFolderContents'> => EMPTY),
  getFolderContext: vi.fn((): BrowseReturn<'getFolderContext'> => EMPTY),
  getChildren: vi.fn((): BrowseReturn<'getChildren'> => EMPTY),
  hasChildCollections: vi.fn((): BrowseReturn<'hasChildCollections'> => of(false)),
  getTrashedChildren: vi.fn((): BrowseReturn<'getTrashedChildren'> => EMPTY),
  restoreDocument: vi.fn((): BrowseReturn<'restoreDocument'> => EMPTY),
  startCsvExport: vi.fn((): BrowseReturn<'startCsvExport'> => EMPTY),
  pollAndDownloadCsv: vi.fn((): BrowseReturn<'pollAndDownloadCsv'> => EMPTY),
};

const detail = {
  getFullDocument: vi.fn((): DetailReturn<'getFullDocument'> => EMPTY),
  getDocumentPermissions: vi.fn((): DetailReturn<'getDocumentPermissions'> => EMPTY),
  fetchThumbnail: vi.fn((): DetailReturn<'fetchThumbnail'> => EMPTY),
  getAuditLog: vi.fn((): DetailReturn<'getAuditLog'> => of(emptyAuditLog)),
  trashDocument: vi.fn((): DetailReturn<'trashDocument'> => EMPTY),
  exportZip: vi.fn((): DetailReturn<'exportZip'> => EMPTY),
  exportXml: vi.fn((): DetailReturn<'exportXml'> => EMPTY),
  subscribe: vi.fn((): DetailReturn<'subscribe'> => EMPTY),
  unsubscribe: vi.fn((): DetailReturn<'unsubscribe'> => EMPTY),
};

const directory = {
  getEventTypes: vi.fn((): DirectoryReturn<'getEventTypes'> => of([])),
  getEventCategories: vi.fn((): DirectoryReturn<'getEventCategories'> => of([])),
};

const tag = {
  searchTags: vi.fn((): TagReturn<'searchTags'> => of([])),
  addTag: vi.fn((): TagReturn<'addTag'> => EMPTY),
  removeTag: vi.fn((): TagReturn<'removeTag'> => EMPTY),
};

const manifest = signal<{ extensionLayers: readonly unknown[] }>({ extensionLayers: [] });

/**
 * Every action the browse toolbar, side panel and tabs can start, in both its
 * success and its failure branch.
 *
 * Shallow-rendered like `browse.spec.ts` — the template is stubbed — because what
 * is under test here is the orchestration and the resulting signal state, not the
 * markup. `browse.listing.spec.ts` covers the rendered surface.
 */
describe('BrowseComponent — actions', () => {
  let component: BrowseComponent;
  let fixture: ComponentFixture<BrowseComponent>;
  let toast: { show: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  let dialogOpen: ReturnType<typeof vi.fn>;
  let anchorClicks: { href: string; download: string }[];
  let originalAnchorClick: () => void;
  let originalCreate: typeof URL.createObjectURL;
  let originalRevoke: typeof URL.revokeObjectURL;
  let revoked: string[];

  beforeEach(async () => {
    vi.clearAllMocks();
    toast = { show: vi.fn(), error: vi.fn() };
    TestBed.overrideProvider(NxsToastService, { useValue: toast });
    dialogOpen = vi.fn(() => ({ afterClosed: () => of(undefined) }));
    // `vi.clearAllMocks()` clears recorded calls but keeps implementations, and the
    // component issues its first folder request from the constructor — so without
    // this reset each test inherits the previous test's listing.
    browse.getBrowseFolderContents.mockReturnValue(EMPTY);
    browse.getFolderContext.mockReturnValue(EMPTY);
    browse.getByPath.mockReturnValue(EMPTY);
    browse.startCsvExport.mockReturnValue(EMPTY);
    browse.pollAndDownloadCsv.mockReturnValue(EMPTY);
    browse.getTrashedChildren.mockReturnValue(EMPTY);
    browse.restoreDocument.mockReturnValue(EMPTY);
    browse.hasChildCollections.mockReturnValue(of(false));
    detail.exportZip.mockReturnValue(EMPTY);
    detail.exportXml.mockReturnValue(EMPTY);
    detail.fetchThumbnail.mockReturnValue(EMPTY);
    detail.subscribe.mockReturnValue(EMPTY);
    detail.unsubscribe.mockReturnValue(EMPTY);
    detail.getAuditLog.mockReturnValue(of(emptyAuditLog));
    tag.addTag.mockReturnValue(EMPTY);
    tag.removeTag.mockReturnValue(EMPTY);
    directory.getEventTypes.mockReturnValue(of([]));
    directory.getEventCategories.mockReturnValue(of([]));
    tag.searchTags.mockReturnValue(of([]));

    anchorClicks = [];
    originalAnchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      anchorClicks.push({ href: this.href, download: this.download });
    };
    revoked = [];
    originalCreate = URL.createObjectURL;
    originalRevoke = URL.revokeObjectURL;
    let counter = 0;
    URL.createObjectURL = vi.fn(() => `blob:mock/${counter++}`);
    URL.revokeObjectURL = vi.fn((url: string) => revoked.push(url));

    manifest.set({ extensionLayers: [] });
    await TestBed.configureTestingModule({
      imports: [testTranslateModule(), testTranslateModule(), BrowseComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([], withDisabledInitialNavigation()),
        { provide: BrowseService, useValue: browse },
        { provide: DocumentDetailService, useValue: detail },
        { provide: DirectoryService, useValue: directory },
        { provide: TagService, useValue: tag },
        { provide: CURRENT_USERNAME, useValue: () => 'jdoe' },
        {
          provide: ADMIN_ACCESS_CHECKS,
          useValue: {
            isAdministrator: () => false,
            isPowerUser: () => false,
            hasAdministrationAccess: () => false,
          },
        },
        { provide: MatDialog, useValue: { open: dialogOpen } },
        { provide: AppConfigService, useValue: { manifest } },
      ],
    })
      .overrideComponent(BrowseComponent, { set: { imports: [], template: '<div></div>' } })
      .compileComponents();

    fixture = TestBed.createComponent(BrowseComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    fixture.destroy();
    HTMLAnchorElement.prototype.click = originalAnchorClick;
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  });

  /** The data object the component handed to `MatDialog.open` for a given call. */
  function dialogData<T>(call = 0): T {
    return (dialogOpen.mock.calls[call][1] as { data: T }).data;
  }

  // ── CSV export ──

  it('exportCsv downloads the polled blob and clears the exporting flag', () => {
    component.currentDoc.set(doc({ uid: 'ws-1', title: 'Q3 Workspace' }));
    browse.startCsvExport.mockReturnValue(of('cmd-1'));
    browse.pollAndDownloadCsv.mockReturnValue(of(new Blob(['a,b'], { type: 'text/csv' })));

    component.exportCsv();

    expect(browse.startCsvExport).toHaveBeenCalledWith('ws-1');
    expect(browse.pollAndDownloadCsv).toHaveBeenCalledWith('cmd-1');
    expect(anchorClicks).toEqual([{ href: 'blob:mock/0', download: 'Q3 Workspace.csv' }]);
    expect(revoked).toEqual(['blob:mock/0']);
    expect(component.csvExporting()).toBe(false);
    expect(toast.show).toHaveBeenCalledWith('CSV exported successfully');
  });

  it('exportCsv clears the exporting flag when the bulk action fails, so the user can retry', () => {
    component.currentDoc.set(doc({ uid: 'ws-1' }));
    browse.startCsvExport.mockReturnValue(throwError(() => ({ status: 500 })));

    component.exportCsv();

    expect(component.csvExporting()).toBe(false);
    expect(anchorClicks).toEqual([]);
    expect(toast.error).toHaveBeenCalledWith('CSV export failed.');
  });

  it('exportCsv clears the exporting flag when polling for the result fails', () => {
    component.currentDoc.set(doc({ uid: 'ws-1' }));
    browse.startCsvExport.mockReturnValue(of('cmd-1'));
    browse.pollAndDownloadCsv.mockReturnValue(throwError(() => ({ status: 504 })));

    component.exportCsv();

    expect(component.csvExporting()).toBe(false);
    expect(toast.error).toHaveBeenCalledWith('CSV export failed.');
  });

  it('exportCsv does nothing without a browsed document', () => {
    component.exportCsv();

    expect(browse.startCsvExport).not.toHaveBeenCalled();
    expect(component.csvExporting()).toBe(false);
  });

  it('exportCsv ignores a second press while an export is already running', () => {
    component.currentDoc.set(doc({ uid: 'ws-1' }));
    browse.startCsvExport.mockReturnValue(new Subject<never>());

    component.exportCsv();
    component.exportCsv();

    expect(component.csvExporting()).toBe(true);
    expect(browse.startCsvExport).toHaveBeenCalledTimes(1);
  });

  // ── ZIP download ──

  it('downloadAll saves the export under the document title', () => {
    component.currentDoc.set(doc({ uid: 'ws-1', title: 'Contracts' }));
    detail.exportZip.mockReturnValue(of(new Blob(['zip'])));

    component.downloadAll();

    expect(detail.exportZip).toHaveBeenCalledWith('ws-1', 'Contracts.zip');
    expect(anchorClicks).toEqual([{ href: 'blob:mock/0', download: 'Contracts.zip' }]);
    expect(revoked).toEqual(['blob:mock/0']);
  });

  it('downloadAll reports a failed export instead of saving an empty file', () => {
    component.currentDoc.set(doc({ uid: 'ws-1', title: 'Contracts' }));
    detail.exportZip.mockReturnValue(throwError(() => ({ status: 500 })));

    component.downloadAll();

    expect(anchorClicks).toEqual([]);
    expect(toast.error).toHaveBeenCalledWith('Download failed.');
  });

  it('downloadAll does nothing without a browsed document', () => {
    component.downloadAll();

    expect(detail.exportZip).not.toHaveBeenCalled();
  });

  // ── Share / export dialogs ──

  it('openShareDialog passes the document title and the current location', () => {
    component.currentDoc.set(doc({ uid: 'ws-1', title: 'Contracts' }));

    component.openShareDialog();

    expect(dialogData<{ title: string; url: string }>().title).toBe('Contracts');
    expect(dialogData<{ title: string; url: string }>().url).toBe(window.location.href);
  });

  it('openShareDialog does nothing without a browsed document', () => {
    component.openShareDialog();

    expect(dialogOpen).not.toHaveBeenCalled();
  });

  it('openExportDialog routes each export type to its own service call', () => {
    component.currentDoc.set(doc({ uid: 'ws-1', title: 'Contracts' }));
    const zip = of(new Blob(['zip']));
    const xml = of(new Blob(['<xml/>']));
    const thumb = of(new Blob(['png']));
    detail.exportZip.mockReturnValue(zip);
    detail.exportXml.mockReturnValue(xml);
    detail.fetchThumbnail.mockReturnValue(thumb);

    component.openExportDialog();
    const data = dialogData<ExportDialogData>();

    expect(data.documentUid).toBe('ws-1');
    expect(data.documentTitle).toBe('Contracts');
    expect(data.exportFn('zip', 'ws-1')).toBe(zip);
    expect(data.exportFn('xml', 'ws-1')).toBe(xml);
    expect(data.exportFn('thumbnail', 'ws-1')).toBe(thumb);
    expect(data.exportFn('pdf', 'ws-1')).toBe(thumb);
    expect(detail.exportZip).toHaveBeenCalledWith('ws-1');
  });

  it('openExportDialog does nothing without a browsed document', () => {
    component.openExportDialog();

    expect(dialogOpen).not.toHaveBeenCalled();
  });

  it('openDriveDialog falls back to the repository root when nothing is browsed', () => {
    component.openDriveDialog();

    expect(dialogData<{ folderPath: string }>()).toEqual({ folderPath: '/' });
  });

  it('openDriveDialog opens Drive on the browsed folder', () => {
    component.currentDoc.set(folder);

    component.openDriveDialog();

    expect(dialogData<{ folderPath: string }>()).toEqual({
      folderPath: '/default-domain/workspaces/ws-1',
    });
  });

  // ── Notifications ──

  it('toggleNotify subscribes and announces the subscription', () => {
    component.currentDoc.set(folder);
    detail.subscribe.mockReturnValue(of(folder));
    const refreshed = doc({ ...folder, contextParameters: { subscribedNotifications: ['Any'] } });
    browse.getByPath.mockReturnValue(of(refreshed));

    component.toggleNotify();

    expect(detail.subscribe).toHaveBeenCalledWith('ws-1');
    expect(detail.unsubscribe).not.toHaveBeenCalled();
    expect(component.isSubscribed()).toBe(true);
    expect(toast.show).toHaveBeenCalledWith('Subscribed to notifications');
  });

  it('toggleNotify unsubscribes an already-subscribed folder and announces that', () => {
    component.currentDoc.set(
      doc({ ...folder, contextParameters: { subscribedNotifications: ['Modification'] } }),
    );
    detail.unsubscribe.mockReturnValue(of(folder));
    browse.getByPath.mockReturnValue(of(folder));

    component.toggleNotify();

    expect(detail.unsubscribe).toHaveBeenCalledWith('ws-1');
    expect(detail.subscribe).not.toHaveBeenCalled();
    expect(component.isSubscribed()).toBeFalsy();
    expect(toast.show).toHaveBeenCalledWith('Unsubscribed');
  });

  it('toggleNotify leaves the subscription state untouched when the call fails', () => {
    component.currentDoc.set(folder);
    detail.subscribe.mockReturnValue(throwError(() => ({ status: 500 })));

    component.toggleNotify();

    expect(browse.getByPath).not.toHaveBeenCalled();
    expect(component.isSubscribed()).toBeFalsy();
    expect(toast.error).toHaveBeenCalledWith('Failed to update notifications');
  });

  it('toggleNotify does nothing without a browsed document', () => {
    component.toggleNotify();

    expect(detail.subscribe).not.toHaveBeenCalled();
    expect(detail.unsubscribe).not.toHaveBeenCalled();
  });

  // ── Create / import ──

  it('openCreateImportDialog refuses a non-folderish document with guidance', () => {
    component.currentDoc.set(doc({ uid: 'file-1', type: 'File', facets: [] }));

    component.openCreateImportDialog();

    expect(dialogOpen).not.toHaveBeenCalled();
    expect(toast.show).toHaveBeenCalledWith('Open a folder to create or import content.');
  });

  it('openCreateImportDialog refuses a folder the user cannot add children to', () => {
    component.currentDoc.set(
      doc({ ...folder, contextParameters: { permissions: ['Read'] }, facets: ['Folderish'] }),
    );

    component.openCreateImportDialog();

    expect(dialogOpen).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      TestBed.inject(TranslateService).instant(PERMISSION_DENIED_KEY),
    );
  });

  it('openCreateImportDialog redirects the user out of a Domain container', () => {
    component.currentDoc.set(
      doc({
        uid: 'dom-1',
        type: 'Domain',
        path: '/default-domain',
        facets: ['Folderish'],
        contextParameters: { permissions: ['AddChildren'] },
      }),
    );

    component.openCreateImportDialog();

    expect(dialogOpen).not.toHaveBeenCalled();
    expect(toast.show).toHaveBeenCalledWith(
      'Open Sections, Templates, or Workspaces, then create content inside those folders.',
      { duration: 6000 },
    );
  });

  it('openCreateImportDialog navigates to a freshly created document', () => {
    component.currentDoc.set(folder);
    dialogOpen.mockReturnValue({
      afterClosed: () => of({ navigateToUrl: '/doc/new-1', freshNote: true }),
    });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate');
    const treeRefresh = vi.spyOn(TestBed.inject(BrowseContextService), 'requestTreeRefresh');

    component.openCreateImportDialog();

    expect(treeRefresh).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/doc', 'new-1'], {
      queryParams: { fresh: '1' },
      state: { freshBlobDocument: true, freshNote: true },
    });
  });

  it('openCreateImportDialog follows a non-document url the dialog returns', () => {
    component.currentDoc.set(folder);
    dialogOpen.mockReturnValue({ afterClosed: () => of({ navigateToUrl: '/collections/col-1' }) });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl');

    component.openCreateImportDialog();

    expect(navigate).toHaveBeenCalledWith('/collections/col-1');
  });

  it('openCreateImportDialog browses to a newly created folder path', () => {
    component.currentDoc.set(folder);
    dialogOpen.mockReturnValue({
      afterClosed: () => of({ navigateToPath: '/default-domain/workspaces/new-folder/' }),
    });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl');

    component.openCreateImportDialog();

    expect(navigate).toHaveBeenCalledWith('/browse/default-domain/workspaces/new-folder');
  });

  it('openCreateImportDialog opens a created document by uid', () => {
    component.currentDoc.set(folder);
    dialogOpen.mockReturnValue({ afterClosed: () => of({ navigateToUid: 'new-2' }) });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate');

    component.openCreateImportDialog();

    expect(navigate).toHaveBeenCalledWith(['/doc', 'new-2'], {
      queryParams: { fresh: '1' },
      state: { freshBlobDocument: true, freshNote: false },
    });
  });

  it('openCreateImportDialog only reloads the listing when the dialog just refreshed', () => {
    component.currentDoc.set(folder);
    dialogOpen.mockReturnValue({ afterClosed: () => of({ refreshed: true }) });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl');
    const load = vi.spyOn(component, 'loadContent');

    component.openCreateImportDialog();

    expect(load).toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('openCreateImportDialog does nothing when the dialog is dismissed', () => {
    component.currentDoc.set(folder);
    dialogOpen.mockReturnValue({ afterClosed: () => of(undefined) });
    const load = vi.spyOn(component, 'loadContent');
    const treeRefresh = vi.spyOn(TestBed.inject(BrowseContextService), 'requestTreeRefresh');

    component.openCreateImportDialog();

    expect(load).not.toHaveBeenCalled();
    expect(treeRefresh).not.toHaveBeenCalled();
  });

  it('openCreateImportDialog does nothing without a browsed document', () => {
    component.openCreateImportDialog();

    expect(dialogOpen).not.toHaveBeenCalled();
    expect(toast.show).toHaveBeenCalledWith('Open a folder to create or import content.');
  });

  // ── Metadata edit ──

  it('openEditDialog follows the document to its new path after a rename', () => {
    component.currentDoc.set(folder);
    const renamed = doc({
      ...folder,
      title: 'Renamed',
      path: '/default-domain/workspaces/renamed',
    });
    dialogOpen.mockReturnValue({ afterClosed: () => of(renamed) });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl');
    const load = vi.spyOn(component, 'loadContent');

    component.openEditDialog();

    expect(navigate).toHaveBeenCalledWith('/browse/default-domain/workspaces/renamed');
    expect(TestBed.inject(BrowseContextService).contextPath()).toBe(
      '/default-domain/workspaces/renamed',
    );
    expect(load).not.toHaveBeenCalled();
  });

  it('openEditDialog reloads in place when only the metadata changed', () => {
    component.currentDoc.set(folder);
    const updated = doc({ ...folder, properties: { 'dc:description': 'Updated' } });
    dialogOpen.mockReturnValue({ afterClosed: () => of(updated) });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl');
    const load = vi.spyOn(component, 'loadContent');

    component.openEditDialog();

    expect(navigate).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalled();
    expect(component.currentDoc()?.properties['dc:description']).toBe('Updated');
  });

  it('openEditDialog seeds the dialog from the current Dublin Core values', () => {
    component.currentDoc.set(
      doc({
        ...folder,
        properties: {
          'dc:description': 'A workspace',
          'dc:nature': 'contract',
          'dc:subjects': ['legal'],
          'dc:coverage': 'europe',
          'dc:expired': '2027-01-01T00:00:00.000Z',
        },
      }),
    );

    component.openEditDialog();

    expect(dialogData()).toEqual({
      uid: 'ws-1',
      title: 'Workspace',
      description: 'A workspace',
      nature: 'contract',
      subjects: ['legal'],
      coverage: 'europe',
      expires: '2027-01-01T00:00:00.000Z',
    });
  });

  it('openEditDialog refuses a document the user cannot write', () => {
    component.currentDoc.set(doc({ ...folder, contextParameters: { permissions: ['Read'] } }));

    component.openEditDialog();

    expect(dialogOpen).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      TestBed.inject(TranslateService).instant(PERMISSION_DENIED_KEY),
    );
  });

  it('openEditDialog does nothing without a browsed document', () => {
    component.openEditDialog();

    expect(dialogOpen).not.toHaveBeenCalled();
  });

  // ── Trash tab and restore ──

  it('loads trashed children when the Trash tab is opened, and only once', () => {
    component.currentDoc.set(folder);
    const trashed = doc({ uid: 'del-1', title: 'Deleted.txt' });
    browse.getTrashedChildren.mockReturnValue(
      of({ ...emptyAuditLog, entries: [trashed], totalSize: 1 }),
    );

    component.onTabChange(3);
    component.onTabChange(0);
    component.onTabChange(3);

    expect(browse.getTrashedChildren).toHaveBeenCalledTimes(1);
    expect(browse.getTrashedChildren).toHaveBeenCalledWith('ws-1', 50);
    expect(component.trashedDocs().map((d) => d.uid)).toEqual(['del-1']);
    expect(component.trashLoading()).toBe(false);
  });

  it('clears the trash loading flag when the trash query fails', () => {
    component.currentDoc.set(folder);
    browse.getTrashedChildren.mockReturnValue(throwError(() => ({ status: 500 })));

    component.onTabChange(3);

    expect(component.trashLoading()).toBe(false);
    expect(component.trashedDocs()).toEqual([]);
  });

  it('does not query the trash without a browsed document', () => {
    component.onTabChange(3);

    expect(browse.getTrashedChildren).not.toHaveBeenCalled();
    expect(component.trashLoading()).toBe(false);
  });

  it('restoreDocument reloads both the trash list and the folder listing', () => {
    component.currentDoc.set(folder);
    browse.restoreDocument.mockReturnValue(of(folder));
    browse.getTrashedChildren.mockReturnValue(of({ ...emptyAuditLog, entries: [] }));
    const load = vi.spyOn(component, 'loadContent');

    component.restoreDocument(doc({ uid: 'del-1', title: 'Deleted.txt' }));

    expect(browse.restoreDocument).toHaveBeenCalledWith('del-1');
    expect(browse.getTrashedChildren).toHaveBeenCalled();
    expect(load).toHaveBeenCalled();
    expect(toast.show).toHaveBeenCalledWith('"Deleted.txt" restored');
  });

  it('restoreDocument leaves the listing alone when the untrash operation fails', () => {
    component.currentDoc.set(folder);
    browse.restoreDocument.mockReturnValue(throwError(() => ({ status: 403 })));
    const load = vi.spyOn(component, 'loadContent');

    component.restoreDocument(doc({ uid: 'del-1', title: 'Deleted.txt' }));

    expect(load).not.toHaveBeenCalled();
    expect(browse.getTrashedChildren).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('Failed to restore document.');
  });

  // ── Tags ──

  it('selectTag adds the tag, refreshes the document and clears the input', () => {
    component.currentDoc.set(folder);
    component.tagInput = 'legal';
    component.tagSearchResults.set(['legal']);
    component.showCreateOption.set(true);
    tag.addTag.mockReturnValue(of(undefined));
    browse.getByPath.mockReturnValue(
      of(doc({ ...folder, properties: { 'nxtag:tags': [{ label: 'legal' }] } })),
    );

    component.selectTag('legal');

    expect(tag.addTag).toHaveBeenCalledWith('ws-1', 'legal');
    expect(component.tags()).toEqual(['legal']);
    expect(component.tagInput).toBe('');
    expect(component.tagSearchResults()).toEqual([]);
    expect(component.showCreateOption()).toBe(false);
    expect(toast.show).toHaveBeenCalledWith('Tag "legal" added');
  });

  it('keeps the typed tag in the input when adding it fails', () => {
    component.currentDoc.set(folder);
    component.tagInput = 'legal';
    tag.addTag.mockReturnValue(throwError(() => ({ status: 500 })));

    component.selectTag('legal');

    expect(component.tagInput).toBe('legal');
    expect(browse.getByPath).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('Failed to add tag');
  });

  it('createTag applies the trimmed input and ignores a blank one', () => {
    component.currentDoc.set(folder);
    tag.addTag.mockReturnValue(of(undefined));
    browse.getByPath.mockReturnValue(of(folder));

    component.tagInput = '   ';
    component.createTag();
    expect(tag.addTag).not.toHaveBeenCalled();

    component.tagInput = '  urgent  ';
    component.createTag();
    expect(tag.addTag).toHaveBeenCalledWith('ws-1', 'urgent');
  });

  it('removeTag refreshes the document from the server', () => {
    component.currentDoc.set(
      doc({ ...folder, properties: { 'nxtag:tags': [{ label: 'legal' }, 'urgent'] } }),
    );
    expect(component.tags()).toEqual(['legal', 'urgent']);
    tag.removeTag.mockReturnValue(of(undefined));
    browse.getByPath.mockReturnValue(
      of(doc({ ...folder, properties: { 'nxtag:tags': ['urgent'] } })),
    );

    component.removeTag('legal');

    expect(tag.removeTag).toHaveBeenCalledWith('ws-1', 'legal');
    expect(component.tags()).toEqual(['urgent']);
  });

  it('keeps the tag visible when removing it fails', () => {
    component.currentDoc.set(doc({ ...folder, properties: { 'nxtag:tags': ['legal'] } }));
    tag.removeTag.mockReturnValue(throwError(() => ({ status: 403 })));

    component.removeTag('legal');

    expect(component.tags()).toEqual(['legal']);
    expect(browse.getByPath).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('Failed to remove tag');
  });

  it('does not attempt to tag anything without a browsed document', () => {
    component.selectTag('legal');
    component.removeTag('legal');

    expect(tag.addTag).not.toHaveBeenCalled();
    expect(tag.removeTag).not.toHaveBeenCalled();
  });

  it('hides already-applied tags from the autocomplete and offers to create a new one', async () => {
    component.currentDoc.set(doc({ ...folder, properties: { 'nxtag:tags': ['legal'] } }));
    tag.searchTags.mockReturnValue(of(['legal', 'legacy']));
    component.tagInput = 'leg';

    component.onTagSearch('leg');
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(component.tagSearchResults()).toEqual(['legacy']);
    expect(component.showCreateOption()).toBe(true);
  });

  it('offers no create option when the search returns an exact match', async () => {
    component.currentDoc.set(folder);
    tag.searchTags.mockReturnValue(of(['Legal']));
    component.tagInput = 'legal';

    component.onTagSearch('legal');
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(component.tagSearchResults()).toEqual(['Legal']);
    expect(component.showCreateOption()).toBe(false);
  });

  it('yields no suggestions and swallows a failing tag search', async () => {
    component.currentDoc.set(folder);
    tag.searchTags.mockReturnValue(throwError(() => ({ status: 500 })));
    component.tagInput = 'leg';

    component.onTagSearch('leg');
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(component.tagSearchResults()).toEqual([]);
  });

  // ── Details side panel ──

  it('togglePanel opens and closes the details panel', () => {
    expect(component.panelOpen()).toBe(false);

    component.togglePanel();
    expect(component.panelOpen()).toBe(true);

    component.togglePanel();
    expect(component.panelOpen()).toBe(false);

    component.togglePanel();
    component.closePanel();
    expect(component.panelOpen()).toBe(false);
  });

  it('switchPanelSubTab records the chosen sub-tab', () => {
    component.switchPanelSubTab('tags');
    expect(component.panelSubTab()).toBe('tags');

    component.switchPanelSubTab('activity');
    expect(component.panelSubTab()).toBe('activity');
  });

  it('setViewMode switches between the list and card layouts', () => {
    expect(component.viewMode()).toBe('list');

    component.setViewMode('card');
    expect(component.viewMode()).toBe('card');

    component.setViewMode('list');
    expect(component.viewMode()).toBe('list');
  });

  // ── History tab ──

  it('loads audit entries and the event vocabularies when the History tab is opened', () => {
    component.currentDoc.set(folder);
    directory.getEventTypes.mockReturnValue(of([directoryEntry('documentModified', 'Modified')]));
    directory.getEventCategories.mockReturnValue(
      of([directoryEntry('eventDocumentCategory', 'Document')]),
    );
    detail.getAuditLog.mockReturnValue(
      of({ ...emptyAuditLog, entries: [auditEntry({ id: 1 })], resultsCount: 42 }),
    );

    component.onTabChange(2);

    expect(detail.getAuditLog).toHaveBeenCalledWith('ws-1', 10, 0);
    expect(component.auditEntries()).toHaveLength(1);
    expect(component.auditTotalSize()).toBe(42);
    expect(component.auditLoading()).toBe(false);
    expect(component.availableActions().map((a) => a.id)).toEqual(['documentModified']);
    expect(component.eventLabel('documentModified')).toBe('Modified');
    expect(component.categoryLabel('eventDocumentCategory')).toBe('Document');
  });

  it('falls back to the raw id when the vocabulary has no label for it', () => {
    expect(component.eventLabel('somethingUnmapped')).toBe('somethingUnmapped');
    expect(component.categoryLabel('unknownCategory')).toBe('unknownCategory');
  });

  it('activityLabel prefers the client reason recorded on the audit entry', () => {
    expect(
      component.activityLabel(auditEntry({ id: 1, extended: { clientReason: 'bulk-edit' } })),
    ).toBeTruthy();
  });

  it('reports an empty history for a document the user cannot read', () => {
    component.currentDoc.set(doc({ ...folder, contextParameters: { permissions: [] } }));

    component.onTabChange(2);

    expect(detail.getAuditLog).not.toHaveBeenCalled();
    expect(component.auditEntries()).toEqual([]);
    expect(component.auditTotalSize()).toBe(0);
    expect(component.auditLoading()).toBe(false);
  });

  it('clears the audit loading flag when the audit query fails', () => {
    component.currentDoc.set(folder);
    detail.getAuditLog.mockReturnValue(throwError(() => ({ status: 500 })));

    component.onTabChange(2);

    expect(component.auditLoading()).toBe(false);
    expect(component.auditEntries()).toEqual([]);
  });

  it('retries the audit query when the History tab is reopened after a failure', () => {
    component.currentDoc.set(folder);
    detail.getAuditLog
      .mockReturnValueOnce(throwError(() => ({ status: 500 })))
      .mockReturnValueOnce(of({ ...emptyAuditLog, entries: [auditEntry({ id: 1 })] }));

    component.onTabChange(2);
    component.onTabChange(0);
    component.onTabChange(2);

    expect(detail.getAuditLog).toHaveBeenCalledTimes(2);
    expect(component.auditEntries()).toHaveLength(1);
  });

  it('does not query the audit log without a browsed document', () => {
    component.loadAuditLog();

    expect(detail.getAuditLog).not.toHaveBeenCalled();
  });

  it('onAuditPageChange requests the chosen page from the server', () => {
    component.currentDoc.set(folder);
    detail.getAuditLog.mockReturnValue(of({ ...emptyAuditLog, entries: [auditEntry({ id: 2 })] }));

    component.onAuditPageChange({ pageIndex: 2, pageSize: 25, length: 100 });

    expect(component.auditPageIndex()).toBe(2);
    expect(component.auditPageSize()).toBe(25);
    expect(detail.getAuditLog).toHaveBeenCalledWith('ws-1', 25, 2);
  });

  /**
   * Seen red on purpose by putting `sortActive` / `sortDirection` back as plain
   * fields: the first read memoised the ascending order and the descending
   * assertion received it unchanged. `filteredAuditEntries` is a `computed()`, so
   * anything it filters or sorts on has to be a signal.
   */
  it('onAuditSort reorders the audit rows in both directions without another server call', () => {
    component.auditEntries.set([
      auditEntry({ id: 1, principalName: 'zoe' }),
      auditEntry({ id: 2, principalName: 'adam' }),
    ]);

    component.onAuditSort({ active: 'principalName', direction: 'asc' });
    expect(component.filteredAuditEntries().map((e) => e.principalName)).toEqual(['adam', 'zoe']);

    component.onAuditSort({ active: 'principalName', direction: 'desc' });
    expect(component.filteredAuditEntries().map((e) => e.principalName)).toEqual(['zoe', 'adam']);

    component.onAuditSort({ active: 'principalName', direction: '' });
    expect(component.filteredAuditEntries().map((e) => e.principalName)).toEqual(['zoe', 'adam']);
    expect(detail.getAuditLog).not.toHaveBeenCalled();
  });

  it('filters the audit rows by username as the user types, without refetching', () => {
    component.auditEntries.set([
      auditEntry({ id: 1, principalName: 'zoe' }),
      auditEntry({ id: 2, principalName: 'adam' }),
    ]);
    component.sortDirection.set('');

    component.filterUsername.set('ZO');
    expect(component.filteredAuditEntries().map((e) => e.id)).toEqual([1]);

    component.filterUsername.set('a');
    expect(component.filteredAuditEntries().map((e) => e.id)).toEqual([2]);

    component.filterUsername.set('');
    expect(component.filteredAuditEntries().map((e) => e.id)).toEqual([1, 2]);
    expect(detail.getAuditLog).not.toHaveBeenCalled();
  });

  it('filters the audit rows by action, category and date range', () => {
    component.sortDirection.set('');
    component.auditEntries.set([
      auditEntry({
        id: 1,
        eventId: 'documentCreated',
        category: 'eventDocumentCategory',
        eventDate: '2026-01-10T00:00:00.000Z',
      }),
      auditEntry({
        id: 2,
        eventId: 'documentModified',
        category: 'eventLifeCycleCategory',
        eventDate: '2026-03-10T00:00:00.000Z',
      }),
    ]);

    component.filterAction.set('documentModified');
    expect(component.filteredAuditEntries().map((e) => e.id)).toEqual([2]);
    component.filterAction.set('');

    component.filterCategory.set('eventLifeCycleCategory');
    expect(component.filteredAuditEntries().map((e) => e.id)).toEqual([2]);
    component.filterCategory.set('');

    component.filterDateFrom.set(new Date('2026-02-01T00:00:00.000Z'));
    expect(component.filteredAuditEntries().map((e) => e.id)).toEqual([2]);

    component.filterDateFrom.set(null);
    component.filterDateTo.set(new Date('2026-01-10T00:00:00.000Z'));
    expect(component.filteredAuditEntries().map((e) => e.id)).toEqual([1]);
  });

  // ── Side-panel activity ──

  it('reports no recent activity for a folder the user cannot read', () => {
    component.currentDoc.set(doc({ ...folder, contextParameters: { permissions: [] } }));
    component.activityEntries.set([auditEntry({ id: 9 })]);

    browse.getBrowseFolderContents.mockReturnValue(
      of({
        folder: doc({ ...folder, contextParameters: { permissions: [] } }),
        entries: [],
        totalSize: 0,
      }),
    );
    browse.getFolderContext.mockReturnValue(of(folder));
    component.loadContent();

    expect(detail.getAuditLog).not.toHaveBeenCalled();
    expect(component.activityEntries()).toEqual([]);
    expect(component.activityLoading()).toBe(false);
  });

  it('clears the activity loading flag when the activity query fails', () => {
    browse.getBrowseFolderContents.mockReturnValue(of({ folder, entries: [], totalSize: 0 }));
    browse.getFolderContext.mockReturnValue(of(folder));
    detail.getAuditLog.mockReturnValue(throwError(() => ({ status: 500 })));

    component.loadContent();

    expect(component.activityLoading()).toBe(false);
    expect(component.activityEntries()).toEqual([]);
  });

  it('populates the activity panel from the audit log of the browsed folder', () => {
    browse.getBrowseFolderContents.mockReturnValue(of({ folder, entries: [], totalSize: 0 }));
    browse.getFolderContext.mockReturnValue(of(folder));
    detail.getAuditLog.mockReturnValue(of({ ...emptyAuditLog, entries: [auditEntry({ id: 7 })] }));

    component.loadContent();

    expect(detail.getAuditLog).toHaveBeenCalledWith('ws-1', 5, 0);
    expect(component.activityEntries().map((e) => e.id)).toEqual([7]);
    expect(component.activityLoading()).toBe(false);
  });

  // ── Breadcrumbs ──

  it('onBreadcrumbClick navigates to the crumb href and updates the tree context', () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl');
    const anchor = document.createElement('a');
    anchor.setAttribute('href', '/browse/default-domain/workspaces');
    const span = document.createElement('span');
    anchor.appendChild(span);
    const event = new MouseEvent('click', { cancelable: true });
    span.dispatchEvent(event);

    component.onBreadcrumbClick(event);

    expect(event.defaultPrevented).toBe(true);
    expect(navigate).toHaveBeenCalledWith('/browse/default-domain/workspaces');
    expect(TestBed.inject(BrowseContextService).contextPath()).toBe('/default-domain/workspaces');
  });

  it('onBreadcrumbClick ignores a click that is not on a crumb link', () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl');
    const div = document.createElement('div');
    const event = new MouseEvent('click', { cancelable: true });
    div.dispatchEvent(event);

    component.onBreadcrumbClick(event);

    expect(event.defaultPrevented).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('breadcrumbs link every ancestor and leave the current folder unlinked', () => {
    component.currentDoc.set(
      doc({ uid: 'ws-1', title: 'My Workspace', path: '/default-domain/workspaces/ws-1' }),
    );

    expect(component.breadcrumbs()).toEqual([
      { label: 'Root', href: '/browse' },
      { label: 'default-domain', href: '/browse/default-domain' },
      { label: 'workspaces', href: '/browse/default-domain/workspaces' },
      { label: 'My Workspace' },
    ]);
  });

  // ── Context menu handlers ──

  it('runs the registered handler behind each packaged context-menu id', () => {
    component.currentDoc.set(folder);
    detail.subscribe.mockReturnValue(of(folder));
    browse.getByPath.mockReturnValue(of(folder));
    const registry = TestBed.inject(ExtensionActionRegistry);
    const context = TestBed.inject(ExtensionRuleContextService).context();
    const descriptor = (id: string): ExtensionActionDescriptor => ({ id, label: id });

    expect(registry.execute(descriptor('app.contextMenu.share'), context)).toBe(true);
    expect(dialogOpen).toHaveBeenCalledTimes(1);

    expect(registry.execute(descriptor('app.contextMenu.export'), context)).toBe(true);
    expect(dialogOpen).toHaveBeenCalledTimes(2);

    expect(registry.execute(descriptor('app.contextMenu.subscribe'), context)).toBe(true);
    expect(detail.subscribe).toHaveBeenCalledWith('ws-1');

    expect(registry.execute(descriptor('app.contextMenu.unsubscribe'), context)).toBe(true);
    expect(detail.subscribe).toHaveBeenCalledTimes(2);
  });

  it('withdraws its context-menu handlers when destroyed, so nothing runs against dead state', () => {
    const registry = TestBed.inject(ExtensionActionRegistry);
    expect(registry.has('app.contextMenu.share')).toBe(true);

    fixture.destroy();

    expect(registry.has('app.contextMenu.share')).toBe(false);
    expect(registry.has('app.contextMenu.export')).toBe(false);
    expect(TestBed.inject(ExtensionRuleContextService).flags()).toEqual({});
  });

  it('keeps a customer handler for a packaged context-menu id when destroyed', () => {
    const registry = TestBed.inject(ExtensionActionRegistry);
    const context = TestBed.inject(ExtensionRuleContextService).context();
    const customerRuns: string[] = [];
    registry.register({ 'app.contextMenu.share': { execute: () => customerRuns.push('acme') } });

    fixture.destroy();

    // Ours goes; theirs stays. Withdrawing by id alone deletes both.
    expect(registry.execute({ id: 'app.contextMenu.share', label: 'Share' }, context)).toBe(true);
    expect(customerRuns).toEqual(['acme']);
    expect(dialogOpen).not.toHaveBeenCalled();
  });

  it('publishes the folder subscription state so the Notify Me rule can read it', () => {
    const ruleContext = TestBed.inject(ExtensionRuleContextService);
    component.currentDoc.set(
      doc({ ...folder, contextParameters: { subscribedNotifications: ['Modification'] } }),
    );
    fixture.detectChanges();

    expect(ruleContext.flags()).toEqual({ subscribed: true });

    component.currentDoc.set(folder);
    fixture.detectChanges();

    expect(ruleContext.flags()).toEqual({ subscribed: false });
  });

  it('runContextMenuAction is inert for an id with no registered handler', () => {
    const unknown: ExtensionActionDescriptor = { id: 'acme.contextMenu.escalate', label: 'X' };

    expect(() => component.runContextMenuAction(unknown)).not.toThrow();
    expect(dialogOpen).not.toHaveBeenCalled();
  });

  it('isContextMenuActionEnabled offers an unruled action and follows the flag for a ruled one', () => {
    const ruled: ExtensionActionDescriptor = {
      id: 'app.contextMenu.unsubscribe',
      label: 'Unsubscribe',
      enabledRule: 'app.rules.isSubscribed',
    };

    component.currentDoc.set(folder);
    fixture.detectChanges();
    expect(component.isContextMenuActionEnabled({ id: 'x', label: 'x' })).toBe(true);
    expect(component.isContextMenuActionEnabled(ruled)).toBe(false);

    component.currentDoc.set(
      doc({ ...folder, contextParameters: { subscribedNotifications: ['Modification'] } }),
    );
    fixture.detectChanges();
    expect(component.isContextMenuActionEnabled(ruled)).toBe(true);
  });
});
