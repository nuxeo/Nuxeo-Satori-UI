import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { testTranslateModule } from '@agentic-ui/testing/i18n';
import { provideZonelessChangeDetection } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { of, throwError, type Observable } from 'rxjs';
import { vi } from 'vitest';

import {
  CollectionService,
  DirectoryService,
  PERMISSION_DENIED_KEY,
  type DirectoryEntry,
  type L10nDirectoryEntry,
  type NuxeoDocument,
} from '@nuxeo-satori/platform/nuxeo-client';

import { EditCollectionDialogComponent } from './edit-collection-dialog';
import { NxsToastService } from '@nuxeo-satori/platform/components';

function l10n(id: string, parent: string, labelEn: string): L10nDirectoryEntry {
  return {
    id,
    directoryName: 'l10ncoverage',
    properties: { id, parent, ordering: 0, obsolete: 0, label_en: labelEn },
  };
}

const coverageEntries: L10nDirectoryEntry[] = [
  l10n('africa', '', 'Africa'),
  l10n('tanzania', 'africa', 'Tanzania'),
];

const subjectEntries: L10nDirectoryEntry[] = [
  l10n('art', '', 'Art'),
  l10n('cinema', 'art', 'Cinema'),
];

const mockDialogRef = { close: vi.fn() };

// Explicit element type: `of([])` infers `Observable<never[]>`, so a later
// `mockReturnValue` carrying real entries does not typecheck — invisible under `nx test`,
// which strips types.
const mockDirectoryService = {
  getEntries: vi.fn((): Observable<DirectoryEntry[]> => of([])),
  getAllL10nEntries: vi.fn((name: string) =>
    of(name === 'l10nsubjects' ? subjectEntries : coverageEntries),
  ),
};

const mockCollectionService = {
  updateProperties: vi.fn(
    (_uid: string, _properties: Record<string, unknown>): Observable<NuxeoDocument> =>
      of({} as NuxeoDocument),
  ),
};
const toast = { show: vi.fn(), error: vi.fn() };

const document: NuxeoDocument = {
  uid: 'col-1',
  title: 'My Collection',
  type: 'Collection',
  path: '/default-domain/collections/my-collection',
  lastModified: '2026-01-01T00:00:00.000Z',
  properties: {},
};

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

// NXSAT-192: hierarchical Coverage/Subjects must expose child entries grouped by parent.
describe('EditCollectionDialogComponent (NXSAT-192)', () => {
  let component: EditCollectionDialogComponent;
  let fixture: ComponentFixture<EditCollectionDialogComponent>;

  beforeEach(async () => {
    vi.clearAllMocks();
    TestBed.overrideProvider(NxsToastService, { useValue: toast });
    await TestBed.configureTestingModule({
      imports: [testTranslateModule(), testTranslateModule(), EditCollectionDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: MatDialogRef, useValue: mockDialogRef },
        { provide: MAT_DIALOG_DATA, useValue: { document } },
        { provide: DirectoryService, useValue: mockDirectoryService },
        { provide: CollectionService, useValue: mockCollectionService },
      ],
    })
      .overrideComponent(EditCollectionDialogComponent, {
        set: { imports: [], template: '<div></div>' },
      })
      .compileComponents();

    fixture = TestBed.createComponent(EditCollectionDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await flushAsync();
  });

  it('loads all l10n entries (including children), not just top-level parents', () => {
    expect(mockDirectoryService.getAllL10nEntries).toHaveBeenCalledWith('l10nsubjects');
    expect(mockDirectoryService.getAllL10nEntries).toHaveBeenCalledWith('l10ncoverage');
    expect(component.coverageEntries().map((e) => e.id)).toContain('tanzania');
    expect(component.subjectEntries().map((e) => e.id)).toContain('cinema');
  });

  it('groups coverage children under their parent label for the dropdown', () => {
    const groups = component.groupedCoverageOptions();
    expect(groups).toHaveLength(1);
    expect(groups[0].parentLabel).toBe('Africa');
    expect(groups[0].entries.map((e) => e.id)).toEqual(['tanzania']);
  });

  it('renders the selected child coverage as Parent/Child', () => {
    component.coverage = 'tanzania';
    expect(component.coveragePillLabel('tanzania')).toBe('Africa/Tanzania');
  });

  describe('nature picker', () => {
    it('loads nature entries when the panel opens', () => {
      mockDirectoryService.getEntries.mockReturnValue(
        of([
          {
            id: 'article',
            label: 'Article',
            displayLabel: 'Article',
            ordering: 0,
            obsolete: 0,
            directoryName: 'nature',
          },
        ]),
      );

      component.onNaturePanelOpen(true);

      expect(mockDirectoryService.getEntries).toHaveBeenCalledWith('nature');
      expect(component.natureEntries().length).toBe(1);
    });

    it('clears the search text when the panel closes, and does not refetch', () => {
      component.naturePanelSearch = 'art';
      mockDirectoryService.getEntries.mockClear();

      component.onNaturePanelOpen(false);

      expect(component.naturePanelSearch).toBe('');
      expect(mockDirectoryService.getEntries).not.toHaveBeenCalled();
    });

    it('falls back to the raw id when the entry is not loaded', () => {
      component.natureEntries.set([]);
      expect(component.naturePillLabel('unknown-id')).toBe('unknown-id');
    });
  });

  describe('subjects and coverage panels', () => {
    it('reloads subject entries when the subjects panel opens', () => {
      mockDirectoryService.getAllL10nEntries.mockClear();
      component.onSubjectsPanelOpen(true);
      expect(mockDirectoryService.getAllL10nEntries).toHaveBeenCalledWith('l10nsubjects');
    });

    it('clears the subjects search on close without refetching', () => {
      component.subjectsPanelSearch = 'cin';
      mockDirectoryService.getAllL10nEntries.mockClear();

      component.onSubjectsPanelOpen(false);

      expect(component.subjectsPanelSearch).toBe('');
      expect(mockDirectoryService.getAllL10nEntries).not.toHaveBeenCalled();
    });

    it('reloads coverage entries when the coverage panel opens', () => {
      mockDirectoryService.getAllL10nEntries.mockClear();
      component.onCoveragePanelOpen(true);
      expect(mockDirectoryService.getAllL10nEntries).toHaveBeenCalledWith('l10ncoverage');
    });

    it('clears the coverage search on close without refetching', () => {
      component.coveragePanelSearch = 'afr';
      mockDirectoryService.getAllL10nEntries.mockClear();

      component.onCoveragePanelOpen(false);

      expect(component.coveragePanelSearch).toBe('');
      expect(mockDirectoryService.getAllL10nEntries).not.toHaveBeenCalled();
    });

    it('removes a subject by id and leaves the others', () => {
      component.subjects = ['art', 'cinema'];
      component.removeSubject('art');
      expect(component.subjects).toEqual(['cinema']);
    });
  });

  describe('expires field', () => {
    it('accepts an empty value as valid', () => {
      component.expiresRawText = '';
      component.expires = null;
      expect(component.isExpiresValid()).toBe(true);
      expect(component.showExpiresError()).toBe(false);
    });

    it('treats unparseable text as invalid and shows the error', () => {
      component.expiresRawText = 'not-a-date';
      component.expires = null;
      expect(component.isExpiresValid()).toBe(false);
      expect(component.showExpiresError()).toBe(true);
    });

    it('records raw input and marks the control dirty and touched', () => {
      const control = {
        markAsDirty: vi.fn(),
        markAsTouched: vi.fn(),
        updateValueAndValidity: vi.fn(),
      };
      (component as unknown as { expiresNgModel: unknown }).expiresNgModel = { control };

      component.onExpiresInput({ target: { value: '31/12/2026' } } as unknown as Event);

      expect(component.expiresRawText).toBe('31/12/2026');
      expect(control.markAsDirty).toHaveBeenCalled();
      expect(control.markAsTouched).toHaveBeenCalled();
      // `emitEvent: false` matters — re-emitting here re-enters the same handler.
      expect(control.updateValueAndValidity).toHaveBeenCalledWith({ emitEvent: false });
    });

    it('does not throw when there is no ngModel control yet', () => {
      (component as unknown as { expiresNgModel: unknown }).expiresNgModel = undefined;
      expect(() =>
        component.onExpiresInput({ target: { value: '2026-12-31' } } as unknown as Event),
      ).not.toThrow();
      expect(component.expiresRawText).toBe('2026-12-31');
    });

    it('clears the raw text once a real date is picked', () => {
      component.expiresRawText = 'partially typed';
      component.onExpiresChange(new Date('2026-12-31T00:00:00.000Z'));
      expect(component.expiresRawText).toBe('');
    });

    it('keeps the raw text when the picked date is invalid', () => {
      component.expiresRawText = 'partially typed';
      component.onExpiresChange(new Date('nonsense'));
      // Clearing here would discard what the user typed in favour of an unusable date.
      expect(component.expiresRawText).toBe('partially typed');
    });

    it('keeps the raw text when the date is cleared', () => {
      component.expiresRawText = 'partially typed';
      component.onExpiresChange(null);
      expect(component.expiresRawText).toBe('partially typed');
    });
  });

  describe('save', () => {
    beforeEach(() => {
      component.title = 'Updated title';
      component.description = '';
      component.nature = '';
      component.subjects = [];
      component.coverage = '';
      component.expires = null;
      component.expiresRawText = '';
      component.saving.set(false);
    });

    it('sends trimmed values and nulls for the empty optional fields', () => {
      component.title = '  Spaced  ';
      component.description = '   ';
      mockCollectionService.updateProperties.mockReturnValue(of({ uid: 'col-1' } as NuxeoDocument));

      component.save();

      expect(mockCollectionService.updateProperties).toHaveBeenCalledWith('col-1', {
        'dc:title': 'Spaced',
        // Empty optional text must be null, not '' — an empty string is a value Nuxeo stores.
        'dc:description': null,
        'dc:nature': null,
        'dc:subjects': [],
        'dc:coverage': null,
        'dc:expired': null,
      });
    });

    it('serialises a valid expiry as an ISO string', () => {
      component.expires = new Date('2026-12-31T00:00:00.000Z');
      mockCollectionService.updateProperties.mockReturnValue(of({ uid: 'col-1' } as NuxeoDocument));

      component.save();

      const properties = mockCollectionService.updateProperties.mock.calls[0][1];
      expect(properties['dc:expired']).toBe('2026-12-31T00:00:00.000Z');
    });

    /**
     * Written first as "sends null for an invalid date", which failed: `updateProperties` was
     * never called at all.
     *
     * The reason is worth keeping. `save()` guards on `isExpiresValid()` *before* building the
     * payload, and an `Invalid Date` fails that guard — so the `!Number.isNaN(...)` ternary in
     * the payload is unreachable from here. It is belt-and-braces, not the thing that stops a
     * `RangeError`; the guard is. Asserting the guard is therefore the real behaviour, and a
     * test claiming to cover the NaN branch through `save()` would have been describing a path
     * that cannot execute.
     */
    it('refuses to save an invalid expiry date, before building any payload', () => {
      component.expires = new Date('nonsense');
      mockCollectionService.updateProperties.mockClear();

      component.save();

      expect(component.isExpiresValid()).toBe(false);
      expect(mockCollectionService.updateProperties).not.toHaveBeenCalled();
      expect(component.saving()).toBe(false);
    });

    it('closes with the updated document on success', () => {
      const updated = { uid: 'col-1', title: 'Updated title' } as NuxeoDocument;
      mockCollectionService.updateProperties.mockReturnValue(of(updated));

      component.save();

      expect(mockDialogRef.close).toHaveBeenCalledWith(updated);
      expect(component.saving()).toBe(false);
    });

    it('clears the saving flag and stays open on failure', () => {
      mockCollectionService.updateProperties.mockReturnValue(
        throwError(() => new Error('conflict')),
      );

      component.save();

      // Leaving `saving` true would disable the save button permanently, stranding the user
      // with unsaved edits and no way to retry.
      expect(component.saving()).toBe(false);
      expect(mockDialogRef.close).not.toHaveBeenCalled();
    });

    it('refuses to save an empty or whitespace-only title', () => {
      component.title = '   ';
      component.save();
      expect(mockCollectionService.updateProperties).not.toHaveBeenCalled();
    });

    it('refuses to save while a save is already in flight', () => {
      component.saving.set(true);
      component.save();
      expect(mockCollectionService.updateProperties).not.toHaveBeenCalled();
    });

    it('refuses to save while the expiry field is invalid', () => {
      component.expiresRawText = 'not-a-date';
      component.expires = null;
      component.save();
      expect(mockCollectionService.updateProperties).not.toHaveBeenCalled();
    });
  });

  it('save shows permission denied when update returns 403', () => {
    mockCollectionService.updateProperties.mockReturnValue(throwError(() => ({ status: 403 })));
    component.title = 'Updated title';

    component.save();

    expect(toast.error).toHaveBeenCalledWith(
      TestBed.inject(TranslateService).instant(PERMISSION_DENIED_KEY),
    );
    expect(component.saving()).toBe(false);
    expect(mockDialogRef.close).not.toHaveBeenCalled();
  });

  it('save shows generic failure when update fails for non-auth errors', () => {
    mockCollectionService.updateProperties.mockReturnValue(throwError(() => ({ status: 500 })));
    component.title = 'Updated title';

    component.save();

    expect(toast.error).toHaveBeenCalledWith('Failed to update collection');
    expect(component.saving()).toBe(false);
  });

  it('shows snackbar when vocabulary directories fail to load on init', async () => {
    vi.clearAllMocks();
    mockDirectoryService.getEntries.mockReturnValue(throwError(() => new Error('fail')));
    mockDirectoryService.getAllL10nEntries.mockReturnValue(of([]));

    await TestBed.resetTestingModule();
    TestBed.overrideProvider(NxsToastService, { useValue: toast });
    await TestBed.configureTestingModule({
      imports: [testTranslateModule(), EditCollectionDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: MatDialogRef, useValue: mockDialogRef },
        { provide: MAT_DIALOG_DATA, useValue: { document } },
        { provide: DirectoryService, useValue: mockDirectoryService },
        { provide: CollectionService, useValue: mockCollectionService },
      ],
    })
      .overrideComponent(EditCollectionDialogComponent, {
        set: { imports: [], template: '<div></div>' },
      })
      .compileComponents();

    const failureFixture = TestBed.createComponent(EditCollectionDialogComponent);
    failureFixture.detectChanges();
    await flushAsync();

    expect(toast.error).toHaveBeenCalledWith('Failed to load vocabulary options');
  });
});
