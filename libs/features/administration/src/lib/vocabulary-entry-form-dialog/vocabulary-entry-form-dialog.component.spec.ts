import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Subject, of, throwError } from 'rxjs';

import {
  DEFAULT_VOCABULARY_ORDERING,
  DirectoryService,
  type DirectoryMetadata,
  type ManagedDirectoryEntry,
} from '@nuxeo/satori-platform/nuxeo-client';
import { testTranslateModule } from '@agentic-ui/testing/i18n';

import {
  VocabularyEntryFormDialogComponent,
  type VocabularyEntryFormDialogData,
} from './vocabulary-entry-form-dialog.component';

describe('VocabularyEntryFormDialogComponent', () => {
  let fixture: ComponentFixture<VocabularyEntryFormDialogComponent>;
  let component: VocabularyEntryFormDialogComponent;
  let dialogRef: { close: ReturnType<typeof vi.fn> };
  let directoryService: { getAdminEntries: ReturnType<typeof vi.fn> };

  /** A `ManagedDirectoryEntry` with the fields the dialog reads. */
  function entry(id: string, over: Partial<ManagedDirectoryEntry> = {}): ManagedDirectoryEntry {
    return {
      id,
      directoryName: 'country',
      label: `label.directories.country.${id}`,
      ordering: 1,
      obsolete: false,
      propertyKeys: ['id', 'label', 'ordering', 'obsolete'],
      ...over,
    };
  }

  const continents = [entry('europe'), entry('africa'), entry('americas')];

  /** Builds the dialog with the given `MAT_DIALOG_DATA`. */
  async function createWith(data: VocabularyEntryFormDialogData): Promise<void> {
    dialogRef = { close: vi.fn() };
    directoryService = { getAdminEntries: vi.fn().mockReturnValue(of(continents)) };

    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [VocabularyEntryFormDialogComponent, testTranslateModule()],
      providers: [
        provideZonelessChangeDetection(),
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: DirectoryService, useValue: directoryService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(VocabularyEntryFormDialogComponent);
    component = fixture.componentInstance;
  }

  beforeEach(async () => {
    await createWith({ mode: 'create', directoryName: 'topic' });
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('initial form values', () => {
    it('should start blank in create mode, with the default ordering', () => {
      expect(component.id).toBe('');
      expect(component.label).toBe('');
      expect(component.ordering).toBe(DEFAULT_VOCABULARY_ORDERING);
      expect(component.obsolete).toBe(false);
      expect(component.parent).toBe('');
    });

    it('should prefill from the entry being edited', async () => {
      await createWith({
        mode: 'edit',
        directoryName: 'topic',
        entry: entry('sales', {
          label: 'Sales',
          ordering: 42,
          obsolete: true,
          parent: 'business',
        }),
      });

      expect(component.id).toBe('sales');
      expect(component.label).toBe('Sales');
      expect(component.ordering).toBe(42);
      expect(component.obsolete).toBe(true);
      expect(component.parent).toBe('business');
    });
  });

  describe('the parent field', () => {
    it('should stay hidden for a flat vocabulary, and fetch nothing', async () => {
      await createWith({ mode: 'create', directoryName: 'topic' });

      component.ngOnInit();

      expect(component.showParentField).toBe(false);
      expect(directoryService.getAdminEntries).not.toHaveBeenCalled();
    });

    it('should appear and load its options from the parent vocabulary', async () => {
      await createWith({ mode: 'create', directoryName: 'country' });

      component.ngOnInit();

      // `country` is parented by `continent` in the Web UI, so that is where options come from.
      expect(component.showParentField).toBe(true);
      expect(directoryService.getAdminEntries).toHaveBeenCalledWith('continent');
      expect(component.loadingParents()).toBe(false);
    });

    it('should sort the options by their display label', async () => {
      await createWith({ mode: 'create', directoryName: 'country' });

      component.ngOnInit();

      expect(component.parentOptions().map((o) => o.id)).toEqual(['africa', 'americas', 'europe']);
    });

    it('should show the picker loading until the options arrive', async () => {
      await createWith({ mode: 'create', directoryName: 'country' });
      const pending = new Subject<ManagedDirectoryEntry[]>();
      directoryService.getAdminEntries.mockReturnValue(pending.asObservable());

      component.ngOnInit();
      expect(component.loadingParents()).toBe(true);

      pending.next(continents);
      expect(component.loadingParents()).toBe(false);
    });

    it('should stop loading when the parent options cannot be fetched', async () => {
      await createWith({ mode: 'create', directoryName: 'country' });
      directoryService.getAdminEntries.mockReturnValue(throwError(() => new Error('500')));

      component.ngOnInit();

      expect(component.loadingParents()).toBe(false);
      expect(component.parentOptions()).toEqual([]);
    });

    it('should require a parent when the options come from another vocabulary', async () => {
      await createWith({ mode: 'create', directoryName: 'country' });

      component.ngOnInit();

      expect(component.parentRequired).toBe(true);
    });

    it('should never offer the entry being edited as its own parent', async () => {
      await createWith({
        mode: 'edit',
        directoryName: 'country',
        entry: entry('europe'),
      });

      component.ngOnInit();

      expect(component.parentOptions().map((o) => o.id)).not.toContain('europe');
    });

    it('should appear when an existing entry already has a parent', async () => {
      await createWith({
        mode: 'edit',
        directoryName: 'topic',
        entry: entry('sales', { parent: 'business' }),
      });

      component.ngOnInit();

      // The catalogue says `topic` is flat, but the data says otherwise — hiding the field here
      // would silently drop the parent on save.
      expect(component.showParentField).toBe(true);
    });

    it('should appear when sibling entries carry a parent property key', async () => {
      await createWith({
        mode: 'create',
        directoryName: 'topic',
        siblingEntries: [entry('sales', { propertyKeys: ['id', 'label', 'parent'] })],
      });

      component.ngOnInit();

      expect(component.showParentField).toBe(true);
    });

    it('should stop loading when it cannot work out where the options come from', async () => {
      await createWith({
        mode: 'create',
        directoryName: 'topic',
        siblingEntries: [entry('sales', { propertyKeys: ['id', 'label', 'parent'] })],
      });

      component.ngOnInit();

      // The field is shown because the data implies a hierarchy, but no source vocabulary is
      // known — the picker must not be left spinning forever.
      expect(component.showParentField).toBe(true);
      expect(component.loadingParents()).toBe(false);
      expect(directoryService.getAdminEntries).not.toHaveBeenCalled();
    });
  });

  describe('an l10n vocabulary', () => {
    const l10nMeta = { name: 'l10ncoverage', schema: 'l10nxvocabulary' } as DirectoryMetadata;

    it('should take its parent options from its own top-level entries', async () => {
      await createWith({
        mode: 'create',
        directoryName: 'l10ncoverage',
        directoryMeta: l10nMeta,
        siblingEntries: [
          entry('europe', { label: 'Europe', parent: undefined }),
          entry('france', { label: 'France', parent: 'europe' }),
        ],
      });

      component.ngOnInit();

      // Own entries, so no second request — and only the top-level ones can be parents.
      expect(directoryService.getAdminEntries).not.toHaveBeenCalled();
      expect(component.parentOptions().map((o) => o.id)).toEqual(['europe']);
      expect(component.loadingParents()).toBe(false);
    });

    it('should not offer the entry being edited as its own parent', async () => {
      await createWith({
        mode: 'edit',
        directoryName: 'l10ncoverage',
        directoryMeta: l10nMeta,
        entry: entry('europe', { label: 'Europe' }),
        siblingEntries: [entry('europe', { label: 'Europe' }), entry('asia', { label: 'Asia' })],
      });

      component.ngOnInit();

      expect(component.parentOptions().map((o) => o.id)).toEqual(['asia']);
    });

    it('should not require a parent, since a top-level entry is legitimate', async () => {
      await createWith({
        mode: 'create',
        directoryName: 'l10ncoverage',
        directoryMeta: l10nMeta,
        siblingEntries: [entry('europe', { label: 'Europe' })],
      });

      component.ngOnInit();

      expect(component.parentRequired).toBe(false);
    });

    it('should offer no parents when it has no entries yet', async () => {
      await createWith({
        mode: 'create',
        directoryName: 'l10ncoverage',
        directoryMeta: l10nMeta,
      });

      component.ngOnInit();

      expect(component.parentOptions()).toEqual([]);
      expect(component.loadingParents()).toBe(false);
    });
  });

  describe('onIdChange', () => {
    it('should suggest a label key from the id while the label is untouched', () => {
      component.id = 'sales';

      component.onIdChange();

      expect(component.label).toBe('label.directories.topic.sales');
    });

    it('should keep the suggestion in step while the user keeps editing the id', () => {
      component.id = 'sale';
      component.onIdChange();
      component.id = 'sales';

      component.onIdChange();

      expect(component.label).toBe('label.directories.topic.sales');
    });

    it('should not overwrite a label the user typed themselves', () => {
      component.label = 'Hand-written label';
      component.id = 'sales';

      component.onIdChange();

      expect(component.label).toBe('Hand-written label');
    });

    it('should not suggest anything in edit mode', async () => {
      await createWith({
        mode: 'edit',
        directoryName: 'topic',
        entry: entry('sales', { label: 'Sales' }),
      });

      component.id = 'sales-emea';
      component.onIdChange();

      expect(component.label).toBe('Sales');
    });

    it('should not suggest anything for an l10n vocabulary, whose label is real text', async () => {
      await createWith({
        mode: 'create',
        directoryName: 'l10ncoverage',
        directoryMeta: { name: 'l10ncoverage', schema: 'l10nxvocabulary' } as DirectoryMetadata,
      });

      component.id = 'europe';
      component.onIdChange();

      expect(component.label).toBe('');
    });
  });

  describe('parentOptionLabel', () => {
    it('should humanise an id whose label is an i18n key', () => {
      expect(
        component.parentOptionLabel(
          entry('north_america', { label: 'label.directories.continent.north_america' }),
        ),
      ).toBe('North America');
    });

    it('should show a real label as it is', () => {
      expect(component.parentOptionLabel(entry('europe', { label: 'Europe' }))).toBe('Europe');
    });

    it('should fall back to the formatted id when there is no label', () => {
      expect(component.parentOptionLabel(entry('north-america', { label: '' }))).toBe(
        'North America',
      );
    });
  });

  describe('canSubmit', () => {
    it('should refuse an empty id', () => {
      component.id = '   ';
      expect(component.canSubmit()).toBe(false);
    });

    it('should accept an id alone for a flat vocabulary', () => {
      component.id = 'sales';
      expect(component.canSubmit()).toBe(true);
    });

    it('should refuse a missing parent when one is required', async () => {
      await createWith({ mode: 'create', directoryName: 'country' });
      component.ngOnInit();
      component.id = 'fr';
      component.parent = '  ';

      expect(component.canSubmit()).toBe(false);

      component.parent = 'europe';
      expect(component.canSubmit()).toBe(true);
    });

    it('should refuse a missing label for an l10n vocabulary', async () => {
      await createWith({
        mode: 'create',
        directoryName: 'l10ncoverage',
        directoryMeta: { name: 'l10ncoverage', schema: 'l10nxvocabulary' } as DirectoryMetadata,
      });
      component.ngOnInit();
      component.id = 'europe';
      component.label = '   ';

      // An l10n label is the text a user reads, so there is nothing to fall back to.
      expect(component.canSubmit()).toBe(false);

      component.label = 'Europe';
      expect(component.canSubmit()).toBe(true);
    });
  });

  describe('submit', () => {
    it('should not close the dialog when the form is incomplete', () => {
      component.id = '';

      component.submit();

      expect(dialogRef.close).not.toHaveBeenCalled();
    });

    it('should close with the trimmed id and the form values', () => {
      component.id = '  sales  ';
      component.label = 'Sales';
      component.ordering = 5;
      component.obsolete = true;

      component.submit();

      expect(dialogRef.close).toHaveBeenCalledWith({
        mode: 'create',
        id: 'sales',
        label: 'Sales',
        ordering: 5,
        obsolete: true,
        // Omitted rather than empty, so a flat vocabulary does not gain a blank parent.
        parent: undefined,
      });
    });

    it('should synthesise the label key when the user left the label blank', () => {
      component.id = 'sales';
      component.label = '   ';

      component.submit();

      expect(dialogRef.close).toHaveBeenCalledWith(
        expect.objectContaining({ label: 'label.directories.topic.sales' }),
      );
    });

    it('should close with an empty label rather than a key for an l10n vocabulary', async () => {
      await createWith({
        mode: 'create',
        directoryName: 'l10ncoverage',
        directoryMeta: { name: 'l10ncoverage', schema: 'l10nxvocabulary' } as DirectoryMetadata,
      });
      component.ngOnInit();
      component.id = 'europe';
      component.label = 'Europe';

      component.submit();

      expect(dialogRef.close).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'europe', label: 'Europe' }),
      );
    });

    it('should include the trimmed parent when the field is shown', async () => {
      await createWith({ mode: 'create', directoryName: 'country' });
      component.ngOnInit();
      component.id = 'fr';
      component.label = 'France';
      component.parent = '  europe  ';

      component.submit();

      expect(dialogRef.close).toHaveBeenCalledWith(expect.objectContaining({ parent: 'europe' }));
    });

    it('should report the mode it was opened in', async () => {
      await createWith({
        mode: 'edit',
        directoryName: 'topic',
        entry: entry('sales', { label: 'Sales' }),
      });

      component.submit();

      expect(dialogRef.close).toHaveBeenCalledWith(expect.objectContaining({ mode: 'edit' }));
    });
  });
});
