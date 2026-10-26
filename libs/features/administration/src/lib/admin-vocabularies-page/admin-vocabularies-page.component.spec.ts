import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { describe, it, expect, vi, beforeEach, type MockInstance } from 'vitest';
import { of, throwError, Subject } from 'rxjs';

import { AdminVocabulariesPageComponent } from './admin-vocabularies-page.component';
import {
  DirectoryService,
  DirectoryMetadata,
  ManagedDirectoryEntry,
} from '@nuxeo/satori-platform/nuxeo-client';

describe('AdminVocabulariesPageComponent', () => {
  let component: AdminVocabulariesPageComponent;
  let fixture: ComponentFixture<AdminVocabulariesPageComponent>;
  let mockDirectoryService: {
    getDirectoryCatalog: ReturnType<typeof vi.fn>;
    listDirectoryNames: ReturnType<typeof vi.fn>;
    getAdminEntries: ReturnType<typeof vi.fn>;
    createEntry: ReturnType<typeof vi.fn>;
    updateEntry: ReturnType<typeof vi.fn>;
    deleteEntry: ReturnType<typeof vi.fn>;
  };
  let mockTranslateService: {
    instant: ReturnType<typeof vi.fn>;
  };
  let mockDialog: { open: MockInstance<MatDialog['open']> };
  let mockSnackBar: { open: MockInstance<MatSnackBar['open']> };

  // `DirectoryMetadata` is `{ name, schema?, idField?, parentDirectory?, type? }`. The earlier
  // version of this fixture carried `hasOrdering` / `hasLabel` / `hasObsolete` / `parentField`,
  // none of which exist on the model — the tests passed because nothing reads them, and `country`
  // is special-cased by name. These are the fields the component and its helpers actually branch on.
  const mockCatalog = new Map<string, DirectoryMetadata>([
    [
      'country',
      { name: 'country', idField: 'id', schema: 'xvocabulary', parentDirectory: 'continent' },
    ],
    ['continent', { name: 'continent', idField: 'id', schema: 'vocabulary' }],
  ]);

  const mockDirectoryNames = ['country', 'continent'];

  /**
   * A complete `ManagedDirectoryEntry`.
   *
   * `propertyKeys` and `directoryName` are not optional on the model, and `columns()` iterates
   * `propertyKeys` — a fixture missing it makes the computed throw rather than return a wrong
   * answer. `obsolete` is a boolean, too; the numeric `0` these fixtures used to carry only
   * survived because Vitest strips the types that would have rejected it.
   */
  function managedEntry(
    id: string,
    over: Partial<ManagedDirectoryEntry> = {},
  ): ManagedDirectoryEntry {
    return {
      id,
      directoryName: 'country',
      label: id,
      ordering: 1,
      obsolete: false,
      propertyKeys: ['id', 'label', 'parent', 'obsolete', 'ordering'],
      ...over,
    };
  }

  const mockEntries: ManagedDirectoryEntry[] = [
    managedEntry('us', { label: 'United States', ordering: 1, parent: 'north-america' }),
    managedEntry('ca', { label: 'Canada', ordering: 2, parent: 'north-america' }),
  ];

  beforeEach(async () => {
    mockDirectoryService = {
      getDirectoryCatalog: vi.fn().mockReturnValue(of(mockCatalog)),
      listDirectoryNames: vi.fn().mockReturnValue(of(mockDirectoryNames)),
      getAdminEntries: vi.fn().mockReturnValue(of(mockEntries)),
      createEntry: vi.fn().mockReturnValue(of(undefined)),
      updateEntry: vi.fn().mockReturnValue(of(undefined)),
      deleteEntry: vi.fn().mockReturnValue(of(undefined)),
    };

    mockTranslateService = {
      instant: vi.fn().mockImplementation((key: string) => key),
    };

    await TestBed.configureTestingModule({
      imports: [AdminVocabulariesPageComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: DirectoryService, useValue: mockDirectoryService },
        { provide: TranslateService, useValue: mockTranslateService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminVocabulariesPageComponent);
    component = fixture.componentInstance;

    // `MatDialog` and `MatSnackBar` cannot be replaced with root providers here. This component
    // imports `MatDialogModule` and `MatSnackBarModule`, and an NgModule imported by a standalone
    // component contributes its providers to that component's *node* injector — which shadows
    // anything TestBed provides at the root. A `{ provide: MatDialog, useValue: ... }` override is
    // therefore silently ignored: the component resolves the real service, and calling `open()` on
    // it crashes on internals a hand-written stub never had. Spying on the instance the component
    // actually resolved is what observes the call.
    const injector = fixture.debugElement.injector;
    mockDialog = {
      open: vi
        .spyOn(injector.get(MatDialog), 'open')
        .mockReturnValue({ afterClosed: () => of(undefined) } as never),
    };
    mockSnackBar = {
      open: vi
        .spyOn(injector.get(MatSnackBar), 'open')
        .mockReturnValue({ afterDismissed: () => of({}) } as never),
    };
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('ngOnInit', () => {
    it('should load directories and catalog successfully and auto-select country directory', () => {
      component.ngOnInit();

      expect(mockDirectoryService.getDirectoryCatalog).toHaveBeenCalled();
      expect(mockDirectoryService.listDirectoryNames).toHaveBeenCalled();
      expect(component.directoryNames()).toEqual(mockDirectoryNames);
      expect(component.directoryCatalog()).toEqual(mockCatalog);
      expect(component.selectedDirectory()).toBe('country');
      expect(component.loadingList()).toBe(false);
      expect(mockDirectoryService.getAdminEntries).toHaveBeenCalledWith('country');
    });

    it('should auto-select first directory if country not in list', () => {
      const namesWithoutCountry = ['continent', 'language'];
      mockDirectoryService.listDirectoryNames.mockReturnValue(of(namesWithoutCountry));

      component.ngOnInit();

      expect(component.selectedDirectory()).toBe('continent');
      expect(mockDirectoryService.getAdminEntries).toHaveBeenCalledWith('continent');
    });

    it('should handle empty directory list gracefully', () => {
      mockDirectoryService.listDirectoryNames.mockReturnValue(of([]));
      const catalogEmpty = new Map();
      mockDirectoryService.getDirectoryCatalog.mockReturnValue(of(catalogEmpty));

      component.ngOnInit();

      expect(component.directoryNames()).toEqual([]);
      expect(component.selectedDirectory()).toBe('');
      expect(component.loadingList()).toBe(false);
      expect(mockDirectoryService.getAdminEntries).not.toHaveBeenCalled();
    });

    it('should handle error loading directories and set loadingList to false', () => {
      mockDirectoryService.getDirectoryCatalog.mockReturnValue(
        throwError(() => new Error('Load error')),
      );

      component.ngOnInit();

      expect(component.loadingList()).toBe(false);
    });

    it('should set loadingList to true initially', () => {
      // One `forkJoin` input is held pending, so the in-flight state is observable at all. With both
      // arms synchronous the join completes during `subscribe()` and the flag is already false —
      // deleting `loadingList.set(true)` from `ngOnInit` would have left this green.
      const pendingNames = new Subject<string[]>();
      mockDirectoryService.listDirectoryNames.mockReturnValue(pendingNames.asObservable());
      component.loadingList.set(false);

      component.ngOnInit();
      expect(component.loadingList()).toBe(true);

      pendingNames.next(mockDirectoryNames);
      pendingNames.complete();
      expect(component.loadingList()).toBe(false);
    });
  });

  describe('onDirectoryChange', () => {
    it('should update selectedDirectory signal and trigger loadEntries', () => {
      const loadEntriesSpy = vi.spyOn(component, 'loadEntries');

      component.onDirectoryChange('continent');

      expect(component.selectedDirectory()).toBe('continent');
      expect(loadEntriesSpy).toHaveBeenCalledWith('continent');
    });
  });

  describe('loadEntries', () => {
    it('should handle empty directoryName by clearing entries', () => {
      component.entries.set(mockEntries);

      component.loadEntries('');

      expect(component.entries()).toEqual([]);
      expect(mockDirectoryService.getAdminEntries).not.toHaveBeenCalled();
    });

    it('should set loading state and populate entries on success', () => {
      component.loadEntries('country');

      expect(component.loading()).toBe(false);
      expect(component.entries()).toEqual(mockEntries);
      expect(mockDirectoryService.getAdminEntries).toHaveBeenCalledWith('country');
    });

    it('should ignore stale responses using requestId pattern', () => {
      // Subjects, not Promises: the component pipes the returned value, and a Promise has no
      // `.pipe`. The previous version of this test also put its expectations inside a `setTimeout`
      // the test never awaited, so nothing was asserted even before the type mismatch.
      const firstRequest = new Subject<ManagedDirectoryEntry[]>();
      const secondRequest = new Subject<ManagedDirectoryEntry[]>();
      mockDirectoryService.getAdminEntries
        .mockReturnValueOnce(firstRequest.asObservable())
        .mockReturnValueOnce(secondRequest.asObservable());

      const secondEntries: ManagedDirectoryEntry[] = [
        managedEntry('uk', { label: 'United Kingdom', parent: 'europe' }),
      ];

      component.loadEntries('country');
      component.loadEntries('continent');

      secondRequest.next(secondEntries);
      expect(component.entries()).toEqual(secondEntries);

      // The load-bearing assertion: the superseded first response must not overwrite the second.
      firstRequest.next(mockEntries);
      expect(component.entries()).toEqual(secondEntries);
    });

    it('should apply a response that nothing superseded', () => {
      // The positive control, so the guard above is discriminating rather than dropping everything.
      const request = new Subject<ManagedDirectoryEntry[]>();
      mockDirectoryService.getAdminEntries.mockReturnValue(request.asObservable());

      component.loadEntries('country');
      expect(component.loading()).toBe(true);

      request.next(mockEntries);

      expect(component.entries()).toEqual(mockEntries);
      expect(component.loading()).toBe(false);
    });

    it('should clear entries and skip the request for an empty directory name', () => {
      component.entries.set(mockEntries);
      mockDirectoryService.getAdminEntries.mockClear();

      component.loadEntries('');

      expect(component.entries()).toEqual([]);
      expect(mockDirectoryService.getAdminEntries).not.toHaveBeenCalled();
    });

    it('should handle errors and show snackbar notification', () => {
      mockDirectoryService.getAdminEntries.mockReturnValue(
        throwError(() => new Error('Load error')),
      );

      component.loadEntries('country');

      expect(component.loading()).toBe(false);
      expect(component.entries()).toEqual([]);
      expect(mockSnackBar.open).toHaveBeenCalledWith(
        'admin.message.failed-to-load-vocabulary-entries',
        'common.dismiss',
        { duration: 4000 },
      );
    });

    it('should ignore stale error responses', () => {
      const firstRequest = new Subject<ManagedDirectoryEntry[]>();
      const secondRequest = new Subject<ManagedDirectoryEntry[]>();
      mockDirectoryService.getAdminEntries
        .mockReturnValueOnce(firstRequest.asObservable())
        .mockReturnValueOnce(secondRequest.asObservable());

      component.loadEntries('country');
      component.loadEntries('continent');

      const secondEntries: ManagedDirectoryEntry[] = [
        managedEntry('uk', { label: 'United Kingdom', parent: 'europe' }),
      ];
      secondRequest.next(secondEntries);
      mockSnackBar.open.mockClear();

      firstRequest.error(new Error('Load error'));

      // A superseded *failure* must neither blank the current entries nor raise an error the user
      // cannot act on — the request it belonged to is one they already navigated away from.
      expect(component.entries()).toEqual(secondEntries);
      expect(mockSnackBar.open).not.toHaveBeenCalled();
    });
  });

  describe('parentCellValue', () => {
    it('should return parent value when present', () => {
      expect(component.parentCellValue(managedEntry('us', { parent: 'north-america' }))).toBe(
        'north-america',
      );
    });

    it('should return em-dash for an entry with no parent', () => {
      expect(component.parentCellValue(managedEntry('us'))).toBe('—');
    });
  });

  describe('entryTableLabel', () => {
    it('should show the stored label as it is', () => {
      expect(component.entryTableLabel(managedEntry('us', { label: 'United States' }))).toBe(
        'United States',
      );
    });
  });

  describe('selectedDirectoryMeta', () => {
    it('should return metadata for selected directory', () => {
      component.directoryCatalog.set(mockCatalog);
      component.selectedDirectory.set('country');

      const meta = component.selectedDirectoryMeta();

      expect(meta).toEqual(mockCatalog.get('country'));
    });

    it('should return undefined for non-existent directory', () => {
      component.directoryCatalog.set(mockCatalog);
      component.selectedDirectory.set('non-existent');

      const meta = component.selectedDirectoryMeta();

      expect(meta).toBeUndefined();
    });
  });

  describe('columns', () => {
    it('should put parent before id for a directory whose entries have one', () => {
      component.selectedDirectory.set('country');
      component.directoryCatalog.set(mockCatalog);
      component.entries.set(mockEntries);

      expect(component.columns()).toEqual([
        'parent',
        'id',
        'label',
        'obsolete',
        'ordering',
        'actions',
      ]);
    });

    it('should omit the parent column for a directory with no parent field', () => {
      component.selectedDirectory.set('continent');
      component.directoryCatalog.set(mockCatalog);
      component.entries.set([
        managedEntry('eu', {
          directoryName: 'continent',
          label: 'Europe',
          propertyKeys: ['id', 'label', 'obsolete', 'ordering'],
        }),
      ]);

      expect(component.columns()).toEqual(['id', 'label', 'obsolete', 'ordering', 'actions']);
    });

    it('should fall back to the default columns before any entries have loaded', () => {
      component.selectedDirectory.set('continent');
      component.directoryCatalog.set(mockCatalog);
      component.entries.set([]);

      expect(component.columns()).toEqual(['id', 'label', 'obsolete', 'ordering', 'actions']);
    });
  });

  describe('openCreateEntry', () => {
    beforeEach(() => {
      component.directoryCatalog.set(mockCatalog);
      component.selectedDirectory.set('country');
      component.entries.set(mockEntries);
    });

    it('should open dialog with correct create mode data', () => {
      component.openCreateEntry();

      expect(mockDialog.open).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          data: {
            mode: 'create',
            directoryName: 'country',
            directoryMeta: mockCatalog.get('country'),
            siblingEntries: mockEntries,
          },
          width: '480px',
        }),
      );
    });

    it('should return early if no directory selected', () => {
      component.selectedDirectory.set('');

      component.openCreateEntry();

      expect(mockDialog.open).not.toHaveBeenCalled();
    });
  });

  describe('openEditEntry', () => {
    const entryToEdit = mockEntries[0];

    beforeEach(() => {
      component.directoryCatalog.set(mockCatalog);
      component.selectedDirectory.set('country');
      component.entries.set(mockEntries);
    });

    it('should open dialog with correct edit mode data and entry', () => {
      component.openEditEntry(entryToEdit);

      expect(mockDialog.open).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          data: {
            mode: 'edit',
            directoryName: 'country',
            directoryMeta: mockCatalog.get('country'),
            entry: entryToEdit,
            siblingEntries: mockEntries,
          },
          width: '480px',
        }),
      );
    });

    it('should return early if no directory selected', () => {
      component.selectedDirectory.set('');

      component.openEditEntry(entryToEdit);

      expect(mockDialog.open).not.toHaveBeenCalled();
    });
  });

  describe('confirmDeleteEntry', () => {
    const entryToDelete = mockEntries[0];

    beforeEach(() => {
      component.selectedDirectory.set('country');
      mockDirectoryService.getAdminEntries.mockReturnValue(of(mockEntries));
    });

    it('should open confirmation dialog with translated messages', () => {
      component.confirmDeleteEntry(entryToDelete);

      expect(mockDialog.open).toHaveBeenCalled();
      expect(mockTranslateService.instant).toHaveBeenCalledWith('confirm.delete-vocabulary-entry');
      expect(mockTranslateService.instant).toHaveBeenCalledWith(
        'confirm.delete-vocabulary-entry-named',
        {
          name: 'us',
          directory: 'country',
        },
      );
      expect(mockTranslateService.instant).toHaveBeenCalledWith('confirm.delete');
    });

    it('should delete entry on confirmation and reload entries', () => {
      mockDialog.open.mockReturnValue({
        afterClosed: vi.fn().mockReturnValue(of(true)),
      } as never);

      component.confirmDeleteEntry(entryToDelete);

      expect(mockDirectoryService.deleteEntry).toHaveBeenCalledWith('country', 'us');
      expect(mockDirectoryService.getAdminEntries).toHaveBeenCalledWith('country');
    });

    it('should show success snackbar after deletion', () => {
      mockDialog.open.mockReturnValue({
        afterClosed: vi.fn().mockReturnValue(of(true)),
      } as never);

      component.confirmDeleteEntry(entryToDelete);

      expect(mockSnackBar.open).toHaveBeenCalledWith(
        'admin.message.entry-deleted',
        'common.dismiss',
        { duration: 3000 },
      );
    });

    it('should handle deletion errors with error snackbar', () => {
      mockDialog.open.mockReturnValue({
        afterClosed: vi.fn().mockReturnValue(of(true)),
      } as never);
      mockDirectoryService.deleteEntry.mockReturnValue(throwError(() => new Error('Delete error')));

      component.confirmDeleteEntry(entryToDelete);

      expect(mockSnackBar.open).toHaveBeenCalledWith(
        'admin.message.failed-to-delete-entry',
        'common.dismiss',
        { duration: 4000 },
      );
      expect(component.mutating()).toBe(false);
    });

    it('should do nothing if user cancels confirmation', () => {
      mockDialog.open.mockReturnValue({
        afterClosed: vi.fn().mockReturnValue(of(false)),
      } as never);

      component.confirmDeleteEntry(entryToDelete);

      expect(mockDirectoryService.deleteEntry).not.toHaveBeenCalled();
    });

    it('should return early if no directory selected', () => {
      component.selectedDirectory.set('');

      component.confirmDeleteEntry(entryToDelete);

      expect(mockDialog.open).not.toHaveBeenCalled();
    });

    it('should set mutating state during operation', () => {
      // The delete is held pending so `mutating` is observable as true. With `of(undefined)` the
      // request completes during `subscribe()` and only the false end-state was ever asserted, so
      // removing `mutating.set(true)` would not have failed this.
      const pendingDelete = new Subject<void>();
      mockDirectoryService.deleteEntry.mockReturnValue(pendingDelete.asObservable());
      mockDialog.open.mockReturnValue({
        afterClosed: vi.fn().mockReturnValue(of(true)),
      } as never);

      component.confirmDeleteEntry(entryToDelete);
      expect(component.mutating()).toBe(true);

      pendingDelete.next();
      pendingDelete.complete();
      expect(component.mutating()).toBe(false);
    });
  });

  describe('saveEntry', () => {
    const dialogData = {
      mode: 'create' as const,
      directoryName: 'country',
      directoryMeta: mockCatalog.get('country'),
      siblingEntries: mockEntries,
    };

    const createResult = {
      mode: 'create' as const,
      id: 'uk',
      label: 'United Kingdom',
      ordering: 3,
      obsolete: false,
      parent: 'europe',
    };

    const editResult = {
      mode: 'edit' as const,
      id: 'us',
      label: 'United States Updated',
      ordering: 1,
      obsolete: false,
      parent: 'north-america',
    };

    beforeEach(() => {
      component.directoryCatalog.set(mockCatalog);
      component.selectedDirectory.set('country');
      mockDirectoryService.getAdminEntries.mockReturnValue(of(mockEntries));
    });

    it('should create new entry via directoryService.createEntry for create mode', () => {
      mockDialog.open.mockReturnValue({
        afterClosed: vi.fn().mockReturnValue(of(createResult)),
      } as never);

      component.openCreateEntry();

      expect(mockDirectoryService.createEntry).toHaveBeenCalledWith(
        'country',
        {
          id: 'uk',
          label: 'United Kingdom',
          ordering: 3,
          obsolete: false,
          parent: 'europe',
        },
        mockCatalog.get('country'),
      );
    });

    it('should update existing entry via directoryService.updateEntry for edit mode', () => {
      mockDialog.open.mockReturnValue({
        afterClosed: vi.fn().mockReturnValue(of(editResult)),
      } as never);

      component.openEditEntry(mockEntries[0]);

      expect(mockDirectoryService.updateEntry).toHaveBeenCalledWith(
        'country',
        'us',
        {
          id: 'us',
          label: 'United States Updated',
          ordering: 1,
          obsolete: false,
          parent: 'north-america',
        },
        mockCatalog.get('country'),
      );
    });

    it('should set mutating state during operation', () => {
      // Same reasoning as the delete case: the create is held pending so the `true` half is real.
      const pendingCreate = new Subject<void>();
      mockDirectoryService.createEntry.mockReturnValue(pendingCreate.asObservable());
      mockDialog.open.mockReturnValue({
        afterClosed: vi.fn().mockReturnValue(of(createResult)),
      } as never);

      component.openCreateEntry();
      expect(component.mutating()).toBe(true);

      pendingCreate.next();
      pendingCreate.complete();
      expect(component.mutating()).toBe(false);
    });

    it('should show success snackbar and reload entries after save', () => {
      mockDialog.open.mockReturnValue({
        afterClosed: vi.fn().mockReturnValue(of(createResult)),
      } as never);

      component.openCreateEntry();

      expect(mockSnackBar.open).toHaveBeenCalledWith(
        'admin.vocabularies.entry-created',
        'common.dismiss',
        { duration: 3000 },
      );
      expect(mockDirectoryService.getAdminEntries).toHaveBeenCalledWith('country');
    });

    it('should handle save errors with error snackbar', () => {
      mockDialog.open.mockReturnValue({
        afterClosed: vi.fn().mockReturnValue(of(createResult)),
      } as never);
      mockDirectoryService.createEntry.mockReturnValue(throwError(() => new Error('Save error')));

      component.openCreateEntry();

      expect(mockSnackBar.open).toHaveBeenCalledWith(
        'admin.message.failed-to-save-entry',
        'common.dismiss',
        { duration: 4000 },
      );
      expect(component.mutating()).toBe(false);
    });

    it('should use correct translation key for created message', () => {
      mockDialog.open.mockReturnValue({
        afterClosed: vi.fn().mockReturnValue(of(createResult)),
      } as never);

      component.openCreateEntry();

      expect(mockTranslateService.instant).toHaveBeenCalledWith('admin.vocabularies.entry-created');
    });

    it('should use correct translation key for updated message', () => {
      mockDialog.open.mockReturnValue({
        afterClosed: vi.fn().mockReturnValue(of(editResult)),
      } as never);

      component.openEditEntry(mockEntries[0]);

      expect(mockTranslateService.instant).toHaveBeenCalledWith('admin.vocabularies.entry-updated');
    });

    it('should not call saveEntry when dialog is cancelled', () => {
      mockDialog.open.mockReturnValue({
        afterClosed: vi.fn().mockReturnValue(of(undefined)),
      } as never);

      component.openCreateEntry();

      expect(mockDirectoryService.createEntry).not.toHaveBeenCalled();
      expect(mockDirectoryService.updateEntry).not.toHaveBeenCalled();
    });
  });
});
