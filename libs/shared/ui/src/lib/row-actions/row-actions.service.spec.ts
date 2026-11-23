import { ApplicationRef, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { testTranslateModule } from '@agentic-ui/testing/i18n';
import {
  NxsFolderPickerDialogComponent,
  NxsRenameDialogComponent,
  NxsToastService,
} from '@nuxeo/satori-platform/components';
import {
  EMPTY_EXTENSION_RULE_CONTEXT,
  ExtensionActionRegistry,
  provideSatoriExtensions,
  type ExtensionRuleContext,
} from '@nuxeo/satori-platform/extensions';
import {
  BrowseContextService,
  BrowseService,
  DocumentChangesService,
  DocumentDetailService,
  SelectionService,
  type NuxeoDocument,
} from '@nuxeo/satori-platform/nuxeo-client';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { ConfirmDialogComponent } from '../confirm-dialog/confirm-dialog.component';
import { RowActionsService, providePackagedRowActions } from './row-actions.service';

const ALL = ['Read', 'Write', 'Remove'];

function doc(overrides: Partial<NuxeoDocument> & Pick<NuxeoDocument, 'uid'>): NuxeoDocument {
  return {
    title: overrides.uid,
    type: 'File',
    path: `/claims/2026/${overrides.uid}`,
    lastModified: '2026-11-01T00:00:00.000Z',
    properties: {},
    contextParameters: { permissions: ALL },
    ...overrides,
  } as NuxeoDocument;
}

const claim = doc({
  uid: 'c1',
  title: 'Claim 1',
  properties: { 'file:content': { name: 'claim-1.pdf' } },
});
const folder = doc({ uid: 'f1', title: 'Batch', type: 'Folder', facets: ['Folderish'] });
const destination = { uid: 'dest', path: '/claims/closed', title: 'Closed' };

const IDS = [
  'app.rowActions.download',
  'app.rowActions.rename',
  'app.rowActions.copyTo',
  'app.rowActions.moveTo',
  'app.rowActions.delete',
];

describe('RowActionsService and providePackagedRowActions', () => {
  let dialogResult: unknown;
  let changes: number;
  let detailServiceBuilt: number;
  const dialogOpen = vi.fn();
  const toast = { show: vi.fn(), error: vi.fn() };
  const detail = {
    fetchBlob: vi.fn(() => of(new Blob(['x']))),
    trashDocument: vi.fn(() => of(undefined)),
    getFullDocument: vi.fn((): ReturnType<DocumentDetailService['getFullDocument']> => of(claim)),
  };
  const browse = {
    copyDocuments: vi.fn(() => of([claim])),
    moveDocuments: vi.fn(() => of([claim])),
    hasChildCollections: vi.fn(() => of(false)),
    // What the folder picker reads when it opens.
    getByPath: vi.fn(() => of(doc({ uid: '2026', type: 'Folder', facets: ['Folderish'] }))),
    getChildren: vi.fn(() => of({ entries: [], totalSize: 0 })),
  };

  /**
   * `extra.providers` come before the row actions' own, as a customer library's may. `realDialogs`
   * keeps the root `MatDialog` and the service's own toast, as the app has them.
   */
  function configure(
    extra: Parameters<typeof TestBed.configureTestingModule>[0] = {},
    { realDialogs = false } = {},
  ): void {
    if (!realDialogs) TestBed.overrideProvider(MatDialog, { useValue: { open: dialogOpen } });
    TestBed.configureTestingModule({
      imports: [testTranslateModule()],
      providers: [
        provideZonelessChangeDetection(),
        ...(realDialogs ? [] : [{ provide: NxsToastService, useValue: toast }]),
        {
          provide: DocumentDetailService,
          useFactory: () => {
            detailServiceBuilt += 1;
            return detail;
          },
        },
        { provide: BrowseService, useValue: browse },
        ...(extra.providers ?? []),
        providePackagedRowActions(),
      ],
    });
    TestBed.inject(DocumentChangesService).changes.subscribe(() => (changes += 1));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    dialogResult = undefined;
    changes = 0;
    detailServiceBuilt = 0;
    dialogOpen.mockImplementation(() => ({ afterClosed: () => of(dialogResult) }));
  });

  /** The browser's download, recorded instead of performed: jsdom navigates on an anchor click. */
  function stubDownload(): { downloads: string[]; revoked: string[]; restore: () => void } {
    const originals = {
      click: HTMLAnchorElement.prototype.click,
      create: URL.createObjectURL,
      revoke: URL.revokeObjectURL,
    };
    const downloads: string[] = [];
    const revoked: string[] = [];
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    };
    URL.createObjectURL = () => 'blob:claim';
    URL.revokeObjectURL = (url: string) => revoked.push(url);
    return {
      downloads,
      revoked,
      restore: () => {
        HTMLAnchorElement.prototype.click = originals.click;
        URL.createObjectURL = originals.create;
        URL.revokeObjectURL = originals.revoke;
      },
    };
  }

  const context = (document: NuxeoDocument | null): ExtensionRuleContext => ({
    ...EMPTY_EXTENSION_RULE_CONTEXT,
    document,
  });
  const run = (id: string, document: NuxeoDocument | null) =>
    TestBed.inject(ExtensionActionRegistry).execute({ id, label: id }, context(document));
  const actions = () => TestBed.inject(RowActionsService);

  describe('the registration', () => {
    it('registers the handlers of the five row actions', () => {
      configure();
      const registered = TestBed.inject(ExtensionActionRegistry).registeredActionIds();
      expect(IDS.filter((id) => registered.includes(id))).toEqual(IDS);
    });

    it('does not build DocumentDetailService, which reads the configuration, until an action runs', () => {
      configure();
      TestBed.inject(ExtensionActionRegistry);
      expect(detailServiceBuilt).toBe(0);
      const download = stubDownload();
      try {
        run('app.rowActions.download', claim);
      } finally {
        download.restore();
      }
      expect(detailServiceBuilt).toBe(1);
      expect(detail.fetchBlob).toHaveBeenCalledWith('c1', { clientReason: 'download' });
    });

    it('does nothing without a document in focus', () => {
      configure();
      for (const id of IDS) expect(run(id, null)).toBe(true);
      expect(dialogOpen).not.toHaveBeenCalled();
      expect(detail.fetchBlob).not.toHaveBeenCalled();
      expect(detailServiceBuilt).toBe(0);
    });

    it("is outranked by a customer's handler registered after it", () => {
      configure();
      const customer = vi.fn();
      TestBed.inject(ExtensionActionRegistry).register({
        'app.rowActions.delete': { execute: customer },
      });
      run('app.rowActions.delete', claim);
      expect(customer).toHaveBeenCalledTimes(1);
      expect(dialogOpen).not.toHaveBeenCalled();
    });

    it('leaves NxsToastService unprovided, so a component that forgets provideNxsToast() still fails', () => {
      configure({}, { realDialogs: true });
      expect(TestBed.inject(NxsToastService, null)).toBeNull();
    });

    it('says what it has to say through its own toast when the environment provides none', () => {
      configure({}, { realDialogs: true });
      const snackBar = vi.spyOn(TestBed.inject(MatSnackBar), 'openFromComponent');
      actions().rename(doc({ uid: 'v1', facets: ['Immutable'] }));
      expect(snackBar).toHaveBeenCalledTimes(1);
      expect(snackBar.mock.calls[0][1]?.data).toMatchObject({
        message: 'You do not have permission to perform this action',
        kind: 'error',
      });
    });

    it("is outranked by a customer's handler registered before it", () => {
      const customer = vi.fn();
      configure({
        providers: [
          provideSatoriExtensions({ actions: { 'app.rowActions.rename': { execute: customer } } }),
        ],
      });
      run('app.rowActions.rename', claim);
      expect(customer).toHaveBeenCalledTimes(1);
      expect(dialogOpen).not.toHaveBeenCalled();
    });
  });

  describe('Download', () => {
    it('saves the main file under its own name, and revokes the URL', () => {
      configure();
      const download = stubDownload();
      try {
        run('app.rowActions.download', claim);
      } finally {
        download.restore();
      }
      expect(download.downloads).toEqual(['claim-1.pdf']);
      expect(download.revoked).toEqual(['blob:claim']);
      // Nothing changed, so no list reloads for a download.
      expect(changes).toBe(0);
    });

    it('says a refused download is a permission problem, and a failed one failed', () => {
      configure();
      detail.fetchBlob.mockReturnValueOnce(throwError(() => ({ status: 403 })));
      run('app.rowActions.download', claim);
      expect(toast.error).toHaveBeenLastCalledWith(
        'You do not have permission to perform this action',
      );
      detail.fetchBlob.mockReturnValueOnce(throwError(() => ({ status: 500 })));
      run('app.rowActions.download', claim);
      expect(toast.error).toHaveBeenLastCalledWith('Download failed.');
    });
  });

  describe('Rename', () => {
    it('renames through the rename dialog, then says the documents changed', () => {
      configure();
      const tree = vi.spyOn(TestBed.inject(BrowseContextService), 'requestTreeRefresh');
      dialogResult = { ...claim, title: 'Claim one' };
      run('app.rowActions.rename', claim);
      expect(dialogOpen).toHaveBeenCalledWith(NxsRenameDialogComponent, {
        data: { documentId: 'c1', title: 'Claim 1' },
      });
      expect(toast.show).toHaveBeenCalledWith('Renamed to "Claim one"');
      expect(tree).toHaveBeenCalledTimes(1);
      expect(changes).toBe(1);
    });

    it('changes nothing when the rename is cancelled', () => {
      configure();
      run('app.rowActions.rename', claim);
      expect(toast.show).not.toHaveBeenCalled();
      expect(changes).toBe(0);
    });

    it('refuses an Immutable document even when a manifest clears the rule', () => {
      configure();
      actions().rename(doc({ uid: 'v1', facets: ['Immutable'] }));
      expect(dialogOpen).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledWith('You do not have permission to perform this action');
    });
  });

  describe('Copy to and Move to', () => {
    it('opens the picker on the folder the document is in, never offering a folder inside itself', () => {
      configure();
      dialogResult = destination;
      run('app.rowActions.copyTo', folder);
      expect(dialogOpen).toHaveBeenCalledWith(NxsFolderPickerDialogComponent, {
        data: {
          heading: 'Copy "Batch" to',
          confirmLabel: 'Copy here',
          initialPath: '/claims/2026',
          excludePath: '/claims/2026/f1',
          currentParentPath: undefined,
        },
      });
      expect(browse.copyDocuments).toHaveBeenCalledWith(['f1'], 'dest');
      expect(toast.show).toHaveBeenCalledWith('Copied "Batch" to Closed');
      expect(changes).toBe(1);
    });

    it('moves to the folder chosen, not offering the one it is already in, and deselects it', () => {
      configure();
      const selection = TestBed.inject(SelectionService);
      selection.toggle('c1', 'Claim 1');
      dialogResult = destination;
      run('app.rowActions.moveTo', claim);
      const data = dialogOpen.mock.calls[0][1].data;
      expect(data.initialPath).toBe('/claims/2026');
      expect(data.currentParentPath).toBe('/claims/2026');
      expect(data.excludePath).toBeUndefined();
      expect(browse.moveDocuments).toHaveBeenCalledWith(['c1'], 'dest');
      expect(toast.show).toHaveBeenCalledWith('Moved "Claim 1" to Closed');
      expect(selection.isSelected('c1')).toBe(false);
      expect(changes).toBe(1);
    });

    it('opens the picker on its default folder for a document with no path', () => {
      configure();
      run('app.rowActions.moveTo', doc({ uid: 'p1', path: '' }));
      const data = dialogOpen.mock.calls[0][1].data;
      expect(data.initialPath).toBeUndefined();
      expect(data.currentParentPath).toBeUndefined();
    });

    it('changes nothing when no folder is chosen', () => {
      configure();
      run('app.rowActions.copyTo', claim);
      expect(browse.copyDocuments).not.toHaveBeenCalled();
      expect(changes).toBe(0);
    });

    it('says a refused move is refused, and a failed copy failed, changing nothing', () => {
      configure();
      dialogResult = destination;
      browse.moveDocuments.mockReturnValueOnce(throwError(() => ({ status: 403 })));
      run('app.rowActions.moveTo', claim);
      expect(toast.error).toHaveBeenLastCalledWith(
        'You do not have permission to perform this action',
      );
      browse.copyDocuments.mockReturnValueOnce(throwError(() => new Error('down')));
      run('app.rowActions.copyTo', claim);
      expect(toast.error).toHaveBeenLastCalledWith('The document could not be copied.');
      expect(changes).toBe(0);
    });
  });

  describe('Delete', () => {
    it('asks, then moves the document to the trash, deselects it, and says the documents changed', () => {
      configure();
      const selection = TestBed.inject(SelectionService);
      selection.toggle('c1', 'Claim 1');
      dialogResult = true;
      run('app.rowActions.delete', claim);
      expect(dialogOpen.mock.calls[0][0]).toBe(ConfirmDialogComponent);
      expect(dialogOpen.mock.calls[0][1].data.message).toBe('Move "Claim 1" to trash?');
      expect(detail.trashDocument).toHaveBeenCalledWith('c1');
      expect(toast.show).toHaveBeenCalledWith('Moved to trash');
      expect(selection.isSelected('c1')).toBe(false);
      expect(changes).toBe(1);
    });

    it('trashes nothing when the confirmation is declined', () => {
      configure();
      dialogResult = false;
      run('app.rowActions.delete', claim);
      expect(detail.trashDocument).not.toHaveBeenCalled();
      expect(changes).toBe(0);
    });

    it('says a failed trash failed', () => {
      configure();
      dialogResult = true;
      detail.trashDocument.mockReturnValueOnce(throwError(() => ({ status: 500 })));
      run('app.rowActions.delete', claim);
      expect(toast.error).toHaveBeenCalledWith('Failed to delete');
      expect(changes).toBe(0);
    });

    it('refuses to trash a Collections folder that still holds collections', () => {
      configure();
      browse.hasChildCollections.mockReturnValueOnce(of(true));
      run('app.rowActions.delete', doc({ uid: 'cols', type: 'Collections' }));
      expect(dialogOpen).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledWith(
        'Remove all collections from this folder before deleting it.',
        { duration: 5000 },
      );
    });

    it("deletes a collection through the collection's own confirmation, clearing the selection", () => {
      configure();
      const collection = doc({ uid: 'col', title: 'Claims to review', type: 'Collection' });
      detail.getFullDocument.mockReturnValueOnce(of(collection));
      const selection = TestBed.inject(SelectionService);
      selection.toggle('other', 'Another document');
      dialogResult = true;
      run('app.rowActions.delete', collection);
      expect(detail.getFullDocument).toHaveBeenCalledWith('col');
      expect(dialogOpen.mock.calls[0][1].data).toEqual({
        title: 'Delete Collection',
        message: 'Are you sure you want to delete "Claims to review"?',
        confirmLabel: 'Delete',
      });
      expect(detail.trashDocument).toHaveBeenCalledWith('col');
      expect(selection.selectedCount()).toBe(0);
      expect(toast.show).toHaveBeenCalledWith('Collection moved to trash');
      expect(changes).toBe(1);
    });

    it('refuses a collection its freshly read permissions do not let the user remove', () => {
      configure();
      const collection = doc({ uid: 'col', type: 'Collection' });
      detail.getFullDocument.mockReturnValueOnce(
        of({ ...collection, contextParameters: { permissions: ['Read'] } }),
      );
      run('app.rowActions.delete', collection);
      expect(dialogOpen).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledWith('You do not have permission to perform this action');
    });

    it('says a collection that could not be read, or trashed, failed', () => {
      configure();
      const collection = doc({ uid: 'col', type: 'Collection' });
      detail.getFullDocument.mockReturnValueOnce(throwError(() => ({ status: 500 })));
      run('app.rowActions.delete', collection);
      expect(toast.error).toHaveBeenLastCalledWith('Failed to load collection');
      expect(dialogOpen).not.toHaveBeenCalled();

      detail.getFullDocument.mockReturnValueOnce(of(collection));
      detail.trashDocument.mockReturnValueOnce(throwError(() => ({ status: 500 })));
      dialogResult = true;
      run('app.rowActions.delete', collection);
      expect(toast.error).toHaveBeenLastCalledWith('Failed to delete collection');
      expect(changes).toBe(0);
    });
  });
  describe('from no page, through the root MatDialog', () => {
    afterEach(() => TestBed.inject(MatDialog).closeAll());

    /** What is open, once drawn: the components the dialogs hold, and the overlay's text. */
    function opened(): { components: unknown[]; text: string } {
      TestBed.inject(ApplicationRef).tick();
      return {
        components: TestBed.inject(MatDialog).openDialogs.map((ref) => ref.componentInstance),
        text: document.querySelector('.cdk-overlay-container')?.textContent ?? '',
      };
    }

    it('opens the rename dialog with the document’s title', async () => {
      configure({}, { realDialogs: true });
      run('app.rowActions.rename', claim);
      const { components } = opened();
      expect(components).toHaveLength(1);
      expect(components[0]).toBeInstanceOf(NxsRenameDialogComponent);
      // `ngModel` writes the input's value a microtask after the first change detection.
      await TestBed.inject(ApplicationRef).whenStable();
      TestBed.inject(ApplicationRef).tick();
      const input = document.querySelector<HTMLInputElement>('.cdk-overlay-container input');
      expect(input?.value).toBe('Claim 1');
    });

    it('opens the folder picker on the folder the document is in', () => {
      configure({}, { realDialogs: true });
      run('app.rowActions.moveTo', claim);
      const { components, text } = opened();
      expect(components[0]).toBeInstanceOf(NxsFolderPickerDialogComponent);
      expect(browse.getByPath).toHaveBeenCalledWith('/claims/2026');
      expect(text).toContain('Move "Claim 1" to');
    });

    it('opens the delete confirmation, naming the document', () => {
      configure({}, { realDialogs: true });
      run('app.rowActions.delete', claim);
      const { components, text } = opened();
      expect(components[0]).toBeInstanceOf(ConfirmDialogComponent);
      expect(text).toContain('Move "Claim 1" to trash?');
    });
  });
});
