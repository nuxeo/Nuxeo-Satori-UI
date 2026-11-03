import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import {
  DocumentDetailService,
  TrashService,
  type NuxeoDocument,
  type NuxeoDocumentList,
  type TrashFilters,
  type TrashSearchParams,
} from '@nuxeo/satori-platform/nuxeo-client';
import { TranslateService } from '@ngx-translate/core';
import { Subject, of, throwError, type Observable } from 'rxjs';
import { vi } from 'vitest';

import { NxsConfirmDialogComponent } from '../confirm-dialog/confirm-dialog.component';
import type { NxsDocumentListRowAction } from '../document-list/document-list.component';
import { NxsToastService } from '../toast/toast.service';
import {
  NXS_TRASH_LIST_ID,
  NxsTrashListComponent,
  type NxsTrashListResults,
  type NxsTrashListView,
} from './trash-list.component';

function doc(n: number, extra: Partial<NuxeoDocument> = {}): NuxeoDocument {
  return {
    'entity-type': 'document',
    uid: `uid-${n}`,
    title: `Note ${n}`,
    type: 'Note',
    path: `/ws/note-${n}`,
    isTrashed: true,
    properties: {
      'dc:modified': '2026-11-01T10:00:00.000Z',
      'dc:created': '2026-10-01T10:00:00.000Z',
      'dc:lastContributor': 'jdoe',
      'dc:creator': 'asmith',
    },
    ...extra,
  } as NuxeoDocument;
}

function page(docs: NuxeoDocument[], resultsCount = docs.length): NuxeoDocumentList {
  return {
    entries: docs,
    resultsCount,
    totalSize: resultsCount,
    currentPageSize: docs.length,
    currentPageIndex: 0,
    numberOfPages: Math.max(1, Math.ceil(resultsCount / 50)),
  };
}

/** Accessor for the component's protected members, which only its template uses. */
type Internals = {
  restore(docs: readonly NuxeoDocument[]): void;
  purge(docs: readonly NuxeoDocument[]): void;
  onRowAction(event: NxsDocumentListRowAction): void;
  onSortChange(sort: { key: string; direction: 'asc' | 'desc' } | null): void;
  onSortKey(key: string): void;
  toggleDirection(): void;
  goToPage(index: number): void;
  setView(view: NxsTrashListView): void;
  setSelected(uid: string, on: boolean): void;
  toggleAll(on: boolean): void;
  clearSelection(): void;
  applyColumns(keys: readonly string[]): void;
  exportCsv(): void;
  cellText(doc: NuxeoDocument, key: string): string;
  selectedIds(): readonly string[];
  busy(): ReadonlySet<string>;
  pageIndex(): number;
  hasNextPage(): boolean;
  selectionBusy(): boolean;
  columns(): readonly { key: string }[];
  rowActions(): Record<string, readonly { label: string }[]>;
  pickerColumns(): readonly { label: string }[];
  cardHandlers(): Map<string, { open: (() => void) | null; select: (on: boolean) => void }>;
};

describe('NxsTrashListComponent', () => {
  let fixture: ComponentFixture<NxsTrashListComponent>;
  let searchTrash: ReturnType<
    typeof vi.fn<(params: TrashSearchParams) => Observable<NuxeoDocumentList>>
  >;
  let restoreDocument: ReturnType<typeof vi.fn<(uid: string) => Observable<unknown>>>;
  let permanentlyDelete: ReturnType<typeof vi.fn<(uid: string) => Observable<void>>>;
  let confirmResult: true | undefined;
  let dialogOpen: ReturnType<typeof vi.fn>;
  let toastShow: ReturnType<typeof vi.spyOn>;
  let toastError: ReturnType<typeof vi.spyOn>;

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const internals = (): Internals => fixture.componentInstance as unknown as Internals;

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function create(inputs: Record<string, unknown> = {}): Promise<void> {
    fixture = TestBed.createComponent(NxsTrashListComponent);
    for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
    await render();
  }

  beforeEach(async () => {
    searchTrash = vi.fn(() => of(page([doc(1), doc(2), doc(3)])));
    restoreDocument = vi.fn(() => of({}));
    permanentlyDelete = vi.fn(() => of(undefined));
    confirmResult = true;
    dialogOpen = vi.fn(() => ({ afterClosed: () => of(confirmResult) }));
    toastShow = vi.spyOn(NxsToastService.prototype, 'show').mockImplementation(() => undefined);
    toastError = vi.spyOn(NxsToastService.prototype, 'error').mockImplementation(() => undefined);
    await TestBed.configureTestingModule({
      imports: [NxsTrashListComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: TrashService, useValue: { searchTrash, restoreDocument, permanentlyDelete } },
        { provide: MatDialog, useValue: { open: dialogOpen } },
        {
          provide: DocumentDetailService,
          useValue: { fetchThumbnail: () => throwError(() => ({ status: 404 })) },
        },
      ],
    }).compileComponents();
  });

  afterEach(() => vi.restoreAllMocks());

  it('is addressed by nxs.components.trashList', () => {
    expect(NXS_TRASH_LIST_ID).toBe('nxs.components.trashList');
  });

  describe('searching', () => {
    it('searches the trash newest first, a page at a time, and lists what it finds', async () => {
      await create();
      expect(searchTrash).toHaveBeenCalledWith(
        expect.objectContaining({
          path: '/',
          sortBy: 'dc:created',
          sortOrder: 'desc',
          pageSize: 50,
          currentPageIndex: 0,
        }),
      );
      expect(el().querySelectorAll('tr.nxs-document-list__row')).toHaveLength(3);
      expect(el().querySelector('.nxs-trash-list__count')?.textContent).toContain(
        '3 trashed documents',
      );
    });

    it('says one trashed document in the singular', async () => {
      searchTrash.mockReturnValue(of(page([doc(1)])));
      await create();
      expect(el().querySelector('.nxs-trash-list__count')?.textContent).toContain(
        '1 trashed document',
      );
    });

    it('passes every filter to the search and goes back to the first page when they change', async () => {
      await create();
      internals().goToPage(2);
      await render();
      expect(searchTrash).toHaveBeenLastCalledWith(
        expect.objectContaining({ currentPageIndex: 2 }),
      );

      const filters: TrashFilters = {
        fullText: 'invoice',
        path: '/ws',
        author: 'jdoe',
        sizeRanges: ['small'],
      };
      fixture.componentRef.setInput('filters', filters);
      await render();
      expect(searchTrash).toHaveBeenLastCalledWith(
        expect.objectContaining({ ...filters, currentPageIndex: 0 }),
      );
    });

    it('sorts on the server by the column chosen, and restores the default when it is cleared', async () => {
      await create();
      internals().onSortChange({ key: 'lastContributor', direction: 'asc' });
      await render();
      expect(searchTrash).toHaveBeenLastCalledWith(
        expect.objectContaining({ sortBy: 'dc:lastContributor', sortOrder: 'asc' }),
      );
      internals().onSortChange(null);
      await render();
      expect(searchTrash).toHaveBeenLastCalledWith(
        expect.objectContaining({ sortBy: 'dc:created', sortOrder: 'desc' }),
      );
    });

    it('chooses the order and reverses it from the grid and list toolbar', async () => {
      await create({ initialView: 'grid' });
      internals().onSortKey('title');
      await render();
      expect(searchTrash).toHaveBeenLastCalledWith(
        expect.objectContaining({ sortBy: 'dc:title', sortOrder: 'desc' }),
      );
      (el().querySelector('.nxs-trash-list__direction') as HTMLButtonElement).click();
      await render();
      expect(searchTrash).toHaveBeenLastCalledWith(
        expect.objectContaining({ sortBy: 'dc:title', sortOrder: 'asc' }),
      );
      internals().toggleDirection();
      await render();
      expect(searchTrash).toHaveBeenLastCalledWith(expect.objectContaining({ sortOrder: 'desc' }));
    });

    it('reports loading, then the page and the total, to resultsHandler', async () => {
      const pending = new Subject<NuxeoDocumentList>();
      searchTrash.mockReturnValue(pending);
      const reports: NxsTrashListResults[] = [];
      await create({ resultsHandler: (results: NxsTrashListResults) => reports.push(results) });
      expect(reports.at(-1)).toEqual({ loading: true, documents: [], totalSize: 0 });
      expect(el().querySelector('nxs-spinner')).not.toBeNull();

      pending.next(page([doc(1)], 12));
      await render();
      expect(reports.at(-1)).toEqual({ loading: false, documents: [doc(1)], totalSize: 12 });

      // The next search reports an empty page while it loads, as `NxsTrashListResults` says.
      fixture.componentRef.setInput('filters', {
        fullText: 'q',
        path: '/',
        author: '',
        sizeRanges: [],
      });
      await render();
      expect(reports.at(-1)).toEqual({ loading: true, documents: [], totalSize: 12 });
    });

    it('reads the total from totalSize when resultsCount is missing', async () => {
      searchTrash.mockReturnValue(of({ ...page([doc(1)], 120), resultsCount: undefined }));
      await create();
      expect(el().querySelector('.nxs-trash-list__count')?.textContent).toContain(
        '120 trashed documents',
      );
      expect(el().querySelector('nxs-pager button[disabled]')).not.toBeNull();
    });

    it('treats a negative count as unknown and pages by the server’s own flag', async () => {
      searchTrash.mockReturnValue(
        of({ ...page([doc(1)], -1), totalSize: -1, isNextPageAvailable: true }),
      );
      const reports: NxsTrashListResults[] = [];
      await create({
        initialView: 'list',
        resultsHandler: (results: NxsTrashListResults) => reports.push(results),
      });
      expect(el().querySelector('.nxs-trash-list__count')?.textContent?.trim()).toBe('');
      expect(reports.at(-1)?.totalSize).toBe(-1);
      expect(internals().hasNextPage()).toBe(true);
    });

    it('guesses another page from a full page when the server neither counts nor says', async () => {
      const full = Array.from({ length: 50 }, (_, i) => doc(i + 1));
      searchTrash.mockReturnValue(of({ ...page(full, -1), totalSize: -1 }));
      await create({ initialView: 'list' });
      expect(internals().hasNextPage()).toBe(true);
    });

    it('shows the server error with a retry that searches again, and reports nothing listed', async () => {
      searchTrash.mockReturnValue(throwError(() => ({ status: 500 })));
      const reports: NxsTrashListResults[] = [];
      await create({ resultsHandler: (results: NxsTrashListResults) => reports.push(results) });
      expect(el().querySelector('nxs-error-state')?.textContent).toContain(
        'The trash could not be loaded',
      );
      expect(reports.at(-1)).toEqual({ loading: false, documents: [], totalSize: 0 });

      searchTrash.mockReturnValue(of(page([doc(1)])));
      fixture.componentInstance.reload();
      await render();
      expect(el().querySelector('nxs-error-state')).toBeNull();
      expect(el().querySelectorAll('tr.nxs-document-list__row')).toHaveLength(1);
    });

    it('keeps a refusal its own heading rather than calling it a breakage', async () => {
      searchTrash.mockReturnValue(throwError(() => ({ status: 403 })));
      await create({ initialView: 'list' });
      const state = el().querySelector('nxs-error-state');
      expect(state).not.toBeNull();
      expect(state?.textContent).not.toContain('The trash could not be loaded');
    });

    it('says the trash is empty in every view', async () => {
      searchTrash.mockReturnValue(of(page([])));
      for (const view of ['table', 'grid', 'list'] as const) {
        await create({ initialView: view });
        expect(el().textContent).toContain('The trash is empty');
        expect(el().querySelector('.nxs-trash-list__count')?.textContent).toContain(
          '0 trashed documents',
        );
      }
    });

    it('shows the page before when an action has emptied the last one', async () => {
      await create();
      internals().goToPage(1);
      searchTrash.mockReturnValueOnce(of(page([], 3)));
      await render();
      expect(internals().pageIndex()).toBe(0);
      expect(searchTrash).toHaveBeenLastCalledWith(
        expect.objectContaining({ currentPageIndex: 0 }),
      );
    });
  });

  describe('restoring', () => {
    // The trash search reads the index, which still lists a restored document as trashed for a
    // moment, so the search that follows the action still returns it.
    it('restores one document from its row, says so, and keeps it off the page while the index catches up', async () => {
      const reports: NxsTrashListResults[] = [];
      await create({ resultsHandler: (results: NxsTrashListResults) => reports.push(results) });
      const before = searchTrash.mock.calls.length;
      const reported = reports.length;
      internals().onRowAction({ action: { id: 'restore', label: 'Restore' }, document: doc(2) });
      await render();
      expect(restoreDocument).toHaveBeenCalledWith('uid-2');
      expect(toastShow).toHaveBeenCalledWith('Restored "Note 2".');
      expect(searchTrash.mock.calls.length).toBe(before + 1);
      expect(el().querySelectorAll('tr.nxs-document-list__row')).toHaveLength(2);
      expect(el().querySelector('.nxs-trash-list__count')?.textContent).toContain(
        '2 trashed documents',
      );
      // Searched again without the loader, so the rows never flash.
      expect(reports.slice(reported).every((r) => !r.loading)).toBe(true);
      expect(reports.at(-1)).toEqual({
        loading: false,
        documents: [doc(1), doc(3)],
        totalSize: 2,
      });
    });

    it('shows the documents that move up once an action empties the page', async () => {
      searchTrash.mockReturnValue(of(page([doc(1)], 60)));
      await create();
      searchTrash.mockReturnValue(of(page([doc(2)], 59)));
      internals().restore([doc(1)]);
      await render();
      expect(searchTrash).toHaveBeenLastCalledWith(
        expect.objectContaining({ currentPageIndex: 0 }),
      );
      expect(el().querySelectorAll('tr.nxs-document-list__row')).toHaveLength(1);
      expect(el().querySelector('.nxs-trash-list__count')?.textContent).toContain(
        '59 trashed documents',
      );
    });

    it('goes back a page when an action empties a later one', async () => {
      searchTrash.mockReturnValue(of(page([doc(1)], 51)));
      await create();
      internals().goToPage(1);
      await render();
      internals().restore([doc(1)]);
      await render();
      expect(internals().pageIndex()).toBe(0);
      expect(searchTrash).toHaveBeenLastCalledWith(
        expect.objectContaining({ currentPageIndex: 0 }),
      );
    });

    it('shows the trash empty once its last document leaves, though the index still lists it', async () => {
      searchTrash.mockReturnValue(of(page([doc(1)])));
      await create();
      internals().restore([doc(1)]);
      await render();
      expect(el().textContent).toContain('The trash is empty');
      expect(el().querySelector('.nxs-trash-list__count')?.textContent).toContain(
        '0 trashed documents',
      );
    });

    it('keeps the page and the failed selection when the refresh after an action fails', async () => {
      restoreDocument.mockImplementation((uid) =>
        uid === 'uid-1' ? throwError(() => ({ status: 403 })) : of({}),
      );
      await create();
      internals().setSelected('uid-1', true);
      internals().setSelected('uid-2', true);
      searchTrash.mockReturnValue(throwError(() => ({ status: 500 })));
      internals().restore([doc(1), doc(2)]);
      await render();
      expect(toastError).toHaveBeenCalledWith('The trash could not be refreshed.', {
        retry: expect.any(Function),
      });
      expect(el().querySelector('nxs-error-state')).toBeNull();
      expect(el().querySelectorAll('tr.nxs-document-list__row')).toHaveLength(2);
      expect(internals().selectedIds()).toEqual(['uid-1']);

      searchTrash.mockReturnValue(of(page([doc(1), doc(3)])));
      const retry = toastError.mock.calls.at(-1)?.[1] as { retry: () => void };
      retry.retry();
      await render();
      expect(el().querySelectorAll('tr.nxs-document-list__row')).toHaveLength(2);
      expect(internals().selectedIds()).toEqual(['uid-1']);
    });

    it('fetches a page its own action emptied again, a few times, until the index catches up', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
      try {
        searchTrash.mockReturnValue(of(page([doc(1), doc(2)], 12)));
        await create();
        const before = searchTrash.mock.calls.length;
        internals().restore([doc(1), doc(2)]);
        await vi.runOnlyPendingTimersAsync();
        await render();
        expect(el().textContent).toContain('Nothing on this page');

        await vi.advanceTimersByTimeAsync(1_500);
        await render();
        searchTrash.mockReturnValue(of(page([doc(3)], 10)));
        await vi.advanceTimersByTimeAsync(1_500);
        await render();
        expect(el().querySelectorAll('tr.nxs-document-list__row')).toHaveLength(1);
        const settled = searchTrash.mock.calls.length;
        expect(settled - before).toBeLessThanOrEqual(4);

        await vi.advanceTimersByTimeAsync(10_000);
        expect(searchTrash.mock.calls.length).toBe(settled);
      } finally {
        vi.useRealTimers();
      }
    });

    it('stops fetching an emptied page again after three tries', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
      try {
        searchTrash.mockReturnValue(of(page([doc(1)], 12)));
        await create();
        const before = searchTrash.mock.calls.length;
        internals().restore([doc(1)]);
        await vi.advanceTimersByTimeAsync(20_000);
        await render();
        // The refresh straight after the action, then three more.
        expect(searchTrash.mock.calls.length - before).toBe(4);
      } finally {
        vi.useRealTimers();
      }
    });

    it('lets a refresh that arrives during a filter search load and fail as that search would', async () => {
      const reports: NxsTrashListResults[] = [];
      await create({ resultsHandler: (results: NxsTrashListResults) => reports.push(results) });
      const pendingRestore = new Subject<unknown>();
      restoreDocument.mockReturnValue(pendingRestore);
      internals().restore([doc(1)]);

      searchTrash.mockReturnValue(new Subject<NuxeoDocumentList>());
      fixture.componentRef.setInput('filters', {
        fullText: 'q',
        path: '/',
        author: '',
        sizeRanges: [],
      });
      await render();
      expect(reports.at(-1)?.loading).toBe(true);

      // The restore answers while the filter search is in flight; its refresh fails.
      searchTrash.mockReturnValue(throwError(() => ({ status: 500 })));
      pendingRestore.next({});
      pendingRestore.complete();
      await render();
      expect(
        el().querySelector('nxs-error-state, nxs-document-list nxs-error-state'),
      ).not.toBeNull();
      expect(toastError).not.toHaveBeenCalledWith(
        'The trash could not be refreshed.',
        expect.anything(),
      );
      expect(reports.at(-1)).toEqual({ loading: false, documents: [], totalSize: 0 });
      expect(searchTrash).toHaveBeenLastCalledWith(expect.objectContaining({ fullText: 'q' }));
    });

    it('lists a handled document again once it has been hidden long enough', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        await create();
        internals().restore([doc(2)]);
        await render();
        expect(el().querySelectorAll('tr.nxs-document-list__row')).toHaveLength(2);
        vi.setSystemTime(Date.now() + 31_000);
        fixture.componentInstance.reload();
        await render();
        expect(el().querySelectorAll('tr.nxs-document-list__row')).toHaveLength(3);
      } finally {
        vi.useRealTimers();
      }
    });

    it('reports a refused restore and keeps the document listed', async () => {
      restoreDocument.mockReturnValue(throwError(() => ({ status: 403 })));
      await create();
      const before = searchTrash.mock.calls.length;
      internals().restore([doc(1)]);
      await render();
      expect(toastError).toHaveBeenCalledWith('Could not restore "Note 1".');
      expect(searchTrash.mock.calls.length).toBe(before);
      expect(internals().busy().size).toBe(0);
    });

    it('ignores a second restore while the first is in flight', async () => {
      const pending = new Subject<unknown>();
      restoreDocument.mockReturnValue(pending);
      await create();
      internals().restore([doc(1)]);
      internals().restore([doc(1)]);
      expect(restoreDocument).toHaveBeenCalledTimes(1);
      expect(internals().busy().has('uid-1')).toBe(true);
      pending.next({});
      pending.complete();
      await render();
      expect(internals().busy().has('uid-1')).toBe(false);
    });

    it('restores the selection, keeping the ones that failed selected', async () => {
      restoreDocument.mockImplementation((uid) =>
        uid === 'uid-3' ? throwError(() => ({ status: 500 })) : of({}),
      );
      searchTrash.mockReturnValue(of(page([doc(1), doc(2), doc(3)])));
      await create();
      for (const n of [1, 2, 3]) internals().setSelected(`uid-${n}`, true);
      await render();
      expect(el().querySelector('.nxs-trash-list__selection')?.textContent).toContain('3 selected');

      (el().querySelector('.nxs-trash-list__restore-selected') as HTMLButtonElement).click();
      await render();
      expect(restoreDocument.mock.calls.map(([uid]) => uid)).toEqual(['uid-1', 'uid-2', 'uid-3']);
      expect(toastError).toHaveBeenCalledWith('Could not restore 1 of 3 documents.');
      expect(internals().selectedIds()).toEqual(['uid-3']);
    });

    it('says how many were restored when every one succeeded', async () => {
      await create();
      internals().toggleAll(true);
      internals().restore([doc(1), doc(2)]);
      await render();
      expect(toastShow).toHaveBeenCalledWith('Restored 2 documents.');
    });
  });

  describe('deleting permanently', () => {
    it('asks first, naming the document, and deletes it once confirmed', async () => {
      await create();
      internals().onRowAction({ action: { id: 'purge', label: 'Delete' }, document: doc(1) });
      await render();
      expect(dialogOpen).toHaveBeenCalledWith(NxsConfirmDialogComponent, {
        data: {
          title: 'Delete permanently',
          message: 'Delete "Note 1" permanently? This cannot be undone.',
          confirmLabel: 'Delete permanently',
        },
      });
      expect(permanentlyDelete).toHaveBeenCalledWith('uid-1');
      expect(toastShow).toHaveBeenCalledWith('Deleted "Note 1" permanently.');
    });

    it('sends nothing when the user cancels', async () => {
      confirmResult = undefined;
      await create();
      internals().purge([doc(1)]);
      await render();
      expect(dialogOpen).toHaveBeenCalledTimes(1);
      expect(permanentlyDelete).not.toHaveBeenCalled();
    });

    it('asks once for a selection, with the count, and reports a partial failure', async () => {
      permanentlyDelete.mockImplementation((uid) =>
        uid === 'uid-1' ? throwError(() => ({ status: 403 })) : of(undefined),
      );
      await create();
      internals().setSelected('uid-1', true);
      internals().setSelected('uid-2', true);
      await render();
      (el().querySelector('.nxs-trash-list__purge-selected') as HTMLButtonElement).click();
      await render();
      expect(dialogOpen).toHaveBeenCalledTimes(1);
      expect(dialogOpen.mock.calls[0][1].data.message).toBe(
        'Delete 2 documents permanently? This cannot be undone.',
      );
      expect(permanentlyDelete).toHaveBeenCalledTimes(2);
      expect(toastError).toHaveBeenCalledWith('Could not delete 1 of 2 documents.');
      expect(internals().selectedIds()).toEqual(['uid-1']);
    });

    it('reports a failed delete of one document by its title', async () => {
      permanentlyDelete.mockReturnValue(throwError(() => ({ status: 500 })));
      await create();
      internals().purge([doc(2)]);
      await render();
      expect(toastError).toHaveBeenCalledWith('Could not delete "Note 2".');
    });

    it('says how many were deleted when every one succeeded', async () => {
      await create();
      internals().purge([doc(1), doc(2)]);
      await render();
      expect(toastShow).toHaveBeenCalledWith('Deleted 2 documents permanently.');
    });

    it('does nothing for a document already in flight', async () => {
      restoreDocument.mockReturnValue(new Subject());
      await create();
      internals().restore([doc(1)]);
      internals().purge([doc(1)]);
      expect(dialogOpen).not.toHaveBeenCalled();
    });
  });

  describe('selection', () => {
    it('clears, selects the page and drops ids no longer on the page', async () => {
      await create();
      internals().toggleAll(true);
      expect(internals().selectedIds()).toEqual(['uid-1', 'uid-2', 'uid-3']);
      internals().setSelected('uid-1', true);
      expect(internals().selectedIds()).toHaveLength(3);
      internals().setSelected('uid-1', false);
      expect(internals().selectedIds()).toEqual(['uid-2', 'uid-3']);

      searchTrash.mockReturnValue(of(page([doc(3)])));
      fixture.componentInstance.reload();
      await render();
      expect(internals().selectedIds()).toEqual(['uid-3']);

      await render();
      (el().querySelector('.nxs-trash-list__selection button') as HTMLButtonElement).click();
      expect(internals().selectedIds()).toEqual([]);
      internals().toggleAll(false);
      internals().clearSelection();
      expect(internals().selectedIds()).toEqual([]);
    });

    it('clears the selection when a search fails, so no bar acts on rows no longer shown', async () => {
      await create();
      internals().toggleAll(true);
      searchTrash.mockReturnValue(throwError(() => ({ status: 500 })));
      fixture.componentInstance.reload();
      await render();
      expect(internals().selectedIds()).toEqual([]);
      expect(el().querySelector('.nxs-trash-list__selection')).toBeNull();
    });

    it('holds the selection actions while a page is being fetched', async () => {
      await create();
      internals().setSelected('uid-1', true);
      await render();
      const pending = new Subject<NuxeoDocumentList>();
      searchTrash.mockReturnValue(pending);
      internals().goToPage(1);
      await render();
      expect(internals().selectionBusy()).toBe(true);
      const restore = el().querySelector('.nxs-trash-list__restore-selected') as HTMLButtonElement;
      expect(restore.disabled).toBe(true);
      pending.next(page([doc(1)], 60));
      await render();
      expect(internals().selectionBusy()).toBe(false);
    });

    it('does not offer select all on an empty page', async () => {
      searchTrash.mockReturnValue(of(page([])));
      await create({ initialView: 'list' });
      expect(el().querySelector('.nxs-trash-list__select-all')).toBeNull();
    });
  });

  describe('views', () => {
    it('switches between the table, the grid and the list, marking the one shown', async () => {
      await create();
      const button = (view: string) =>
        el().querySelector(`button[data-view="${view}"]`) as HTMLButtonElement;
      expect(button('table').getAttribute('aria-pressed')).toBe('true');

      button('grid').click();
      await render();
      expect(button('grid').getAttribute('aria-pressed')).toBe('true');
      const cells = el().querySelectorAll('.nxs-trash-list__grid > .nxs-trash-list__card');
      expect(cells).toHaveLength(3);
      expect(el().querySelectorAll('.nxs-trash-list__grid > *')).toHaveLength(3);
      expect([...cells].every((cell) => cell.querySelector('nxs-card'))).toBe(true);
      expect(el().querySelector('nxs-document-list')).toBeNull();

      button('list').click();
      await render();
      expect(el().querySelectorAll('.nxs-trash-list__list-item')).toHaveLength(3);
      expect(el().querySelector('nxs-pager')).not.toBeNull();
    });

    it('opens a card through openHandler and selects it from its checkbox', async () => {
      const opened: string[] = [];
      await create({ initialView: 'grid', openHandler: (d: NuxeoDocument) => opened.push(d.uid) });
      const handlers = internals().cardHandlers().get('uid-2');
      handlers?.open?.();
      handlers?.select(true);
      expect(opened).toEqual(['uid-2']);
      expect(internals().selectedIds()).toEqual(['uid-2']);
    });

    it('gives the cards nothing to open without an openHandler', async () => {
      await create({ initialView: 'grid' });
      expect(internals().cardHandlers().get('uid-1')?.open).toBeNull();
    });

    it('restores, deletes, selects and opens from a list item', async () => {
      const opened: string[] = [];
      await create({ initialView: 'list', openHandler: (d: NuxeoDocument) => opened.push(d.uid) });
      const item = el().querySelectorAll('.nxs-trash-list__list-item')[0] as HTMLElement;
      const buttons = item.querySelectorAll<HTMLButtonElement>(
        '.nxs-trash-list__list-actions button',
      );
      expect(buttons[0].getAttribute('aria-label')).toBe('Restore Note 1');
      expect(buttons[1].getAttribute('aria-label')).toBe('Delete Note 1 permanently');

      buttons[0].click();
      await render();
      expect(restoreDocument).toHaveBeenCalledWith('uid-1');

      // Note 1 has left the page; Note 2 is first now.
      const again = el().querySelectorAll('.nxs-trash-list__list-item')[0] as HTMLElement;
      again.querySelectorAll<HTMLButtonElement>('.nxs-trash-list__list-actions button')[1].click();
      await render();
      expect(permanentlyDelete).toHaveBeenCalledWith('uid-2');

      (el().querySelector('button.nxs-trash-list__list-title') as HTMLButtonElement).click();
      expect(opened).toEqual(['uid-3']);

      (
        el().querySelector('.nxs-trash-list__list-item input[type="checkbox"]') as HTMLInputElement
      ).click();
      await render();
      expect(internals().selectedIds()).toEqual(['uid-3']);
      (
        el().querySelector('.nxs-trash-list__list-item input[type="checkbox"]') as HTMLInputElement
      ).click();
      await render();
      expect(internals().selectedIds()).toEqual([]);

      (
        el().querySelector('.nxs-trash-list__select-all input[type="checkbox"]') as HTMLInputElement
      ).click();
      await render();
      expect(internals().selectedIds()).toEqual(['uid-3']);
    });

    it('shows a list title as text when nothing opens documents', async () => {
      await create({ initialView: 'list' });
      expect(el().querySelector('button.nxs-trash-list__list-title')).toBeNull();
      expect(el().querySelector('span.nxs-trash-list__list-title')?.textContent).toContain(
        'Note 1',
      );
    });

    it('keeps the pager on an empty later page, with no empty-trash heading', async () => {
      searchTrash.mockReturnValue(of({ ...page([], -1), totalSize: -1 }));
      await create({ initialView: 'grid' });
      internals().goToPage(2);
      await render();
      expect(el().querySelector('nxs-empty-state')).toBeNull();
      const pager = el().querySelector('nxs-pager');
      expect(pager).not.toBeNull();
      const previous = pager?.querySelectorAll('button')[0] as HTMLButtonElement;
      expect(previous.disabled).toBe(false);
    });

    it('says only this page is empty when other pages hold documents', async () => {
      searchTrash.mockReturnValue(of({ ...page([], 10), isNextPageAvailable: true }));
      for (const view of ['table', 'list'] as const) {
        await create({ initialView: view });
        expect(el().textContent).toContain('Nothing on this page');
        expect(el().textContent).not.toContain('The trash is empty');
      }
    });

    it('keeps the grid’s pager, disabled, while a page loads, and drops it on an error', async () => {
      await create({ initialView: 'grid' });
      const pending = new Subject<NuxeoDocumentList>();
      searchTrash.mockReturnValue(pending);
      internals().goToPage(1);
      await render();
      const buttons = [...el().querySelectorAll<HTMLButtonElement>('nxs-pager button')];
      expect(buttons.length).toBeGreaterThan(0);
      expect(buttons.every((button) => button.disabled)).toBe(true);
      pending.error({ status: 500 });
      await render();
      expect(el().querySelector('nxs-pager')).toBeNull();
    });

    it('pages the grid with the pager', async () => {
      searchTrash.mockReturnValue(of(page([doc(1)], 120)));
      await create({ initialView: 'grid' });
      internals().goToPage(1);
      await render();
      expect(searchTrash).toHaveBeenLastCalledWith(
        expect.objectContaining({ currentPageIndex: 1 }),
      );
    });
  });

  describe('table', () => {
    it('names the table, offers restore and delete on each row and opens a row', async () => {
      const opened: string[] = [];
      await create({ openHandler: (d: NuxeoDocument) => opened.push(d.uid) });
      expect(el().querySelector('table')?.getAttribute('aria-label')).toBe('Trashed documents');
      (el().querySelector('tr.nxs-document-list__row') as HTMLElement).click();
      expect(opened).toEqual(['uid-1']);
    });

    it('relabels its columns and row actions when the translations change', async () => {
      await create();
      TestBed.inject(TranslateService).setTranslation(
        'en',
        {
          'satori-components': {
            'trash-list': { column: { title: 'Name' }, restore: 'Undelete' },
          },
        },
        true,
      );
      await render();
      expect(internals().columns()[0]).toEqual(expect.objectContaining({ label: 'Name' }));
      expect(internals().rowActions()['uid-1'][0].label).toBe('Undelete');
      expect(internals().pickerColumns()[0].label).toBe('Name');
    });

    it('ignores a row action it does not know', async () => {
      await create();
      internals().onRowAction({ action: { id: 'other', label: 'Other' }, document: doc(1) });
      expect(restoreDocument).not.toHaveBeenCalled();
      expect(dialogOpen).not.toHaveBeenCalled();
    });

    it('chooses its columns from the picker, keeping the title', async () => {
      await create();
      expect(
        internals()
          .columns()
          .map((c) => c.key),
      ).toEqual(['title', 'type', 'modified', 'lastContributor']);
      (el().querySelector('.nxs-trash-list__columns') as HTMLButtonElement).click();
      await render();
      expect(el().querySelector('nxs-column-picker')).not.toBeNull();

      internals().applyColumns(['title', 'created', 'author']);
      await render();
      expect(el().querySelector('nxs-column-picker')).toBeNull();
      expect(
        internals()
          .columns()
          .map((c) => c.key),
      ).toEqual(['title', 'created', 'author']);

      (el().querySelector('.nxs-trash-list__columns') as HTMLButtonElement).click();
      await render();
      internals().setView('grid');
      await render();
      expect(el().querySelector('nxs-column-picker')).toBeNull();
    });
  });

  describe('CSV export', () => {
    it('downloads the page shown, with the columns shown, and revokes the URL', async () => {
      const blobs: Blob[] = [];
      const create$ = vi.fn((blob: Blob) => {
        blobs.push(blob);
        return 'blob:trash';
      });
      const revoke = vi.fn();
      Object.assign(URL, { createObjectURL: create$, revokeObjectURL: revoke });
      const click = vi
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => undefined);

      searchTrash.mockReturnValue(of(page([doc(1, { title: 'Say "hi"' })])));
      await create();
      internals().exportCsv();

      expect(click).toHaveBeenCalledTimes(1);
      expect(revoke).toHaveBeenCalledWith('blob:trash');
      const text = await blobs[0].text();
      expect(text.split('\n')).toEqual([
        '"Title","Type","Modified","Last contributor"',
        '"Say ""hi""","Note","2026-11-01T10:00:00.000Z","jdoe"',
      ]);
    });

    it('reads every column a row can show, and nothing for one it cannot', async () => {
      await create();
      const d = doc(1, { properties: { 'dc:created': 'c', 'dc:creator': 'a', 'dc:modified': 7 } });
      expect(internals().cellText(d, 'created')).toBe('c');
      expect(internals().cellText(d, 'author')).toBe('a');
      expect(internals().cellText(d, 'modified')).toBe('');
      expect(internals().cellText(d, 'unknown')).toBe('');
      expect(internals().cellText(doc(2, { title: '', type: undefined }), 'title')).toBe(
        '/ws/note-2',
      );
      expect(internals().cellText(doc(2, { type: undefined }), 'type')).toBe('');
    });
  });
});
