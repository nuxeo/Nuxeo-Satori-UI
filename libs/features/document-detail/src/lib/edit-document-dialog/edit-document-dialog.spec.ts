import { DateAdapter } from '@angular/material/core';
import { enUS, fr, de, nl, ja, th, zhCN } from 'date-fns/locale';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { testTranslateModule } from '@agentic-ui/testing/i18n';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of, throwError, type Observable } from 'rxjs';
import { vi } from 'vitest';

import {
  BrowseService,
  DirectoryService,
  type DirectoryEntry,
  type L10nDirectoryEntry,
  type NuxeoDocument,
} from '@nuxeo-satori/platform/nuxeo-client';

import { EditDocumentDialogComponent } from './edit-document-dialog';

/**
 * Typed factories that fill EVERY required field.
 *
 * A partial object cast with `as DirectoryEntry` keeps compiling when the model gains a
 * required field, so the fixture drifts from what the component is really handed while the
 * suite stays green.
 */
function directoryEntry(overrides: Partial<DirectoryEntry> = {}): DirectoryEntry {
  return {
    id: 'article',
    label: 'Article',
    displayLabel: 'Article',
    ordering: 0,
    obsolete: 0,
    directoryName: 'nature',
    ...overrides,
  };
}

function l10n(id: string, parent: string, labelEn: string): L10nDirectoryEntry {
  return {
    id,
    directoryName: 'l10ncoverage',
    properties: { id, parent, ordering: 0, obsolete: 0, label_en: labelEn },
  };
}

function docWith(overrides: Partial<NuxeoDocument> = {}): NuxeoDocument {
  return {
    uid: 'doc-1',
    title: 'Fallback title',
    type: 'File',
    path: '/default-domain/workspaces/ws/doc',
    lastModified: '2026-08-01T00:00:00.000Z',
    properties: {},
    ...overrides,
  };
}

const natureEntries: DirectoryEntry[] = [
  directoryEntry({ id: 'article', label: 'Article', displayLabel: 'Article' }),
  directoryEntry({ id: 'memo', label: 'Memo', displayLabel: 'Memo' }),
];

const subjectEntries: L10nDirectoryEntry[] = [
  l10n('art', '', 'Art'),
  l10n('cinema', 'art', 'Cinema'),
  l10n('painting', 'art', 'Painting'),
];

const coverageEntries: L10nDirectoryEntry[] = [
  l10n('africa', '', 'Africa'),
  l10n('tanzania', 'africa', 'Tanzania'),
];

const mockDialogRef = {
  close: vi.fn(),
};

/**
 * Full mock surface up front with explicit return types.
 *
 * `vi.fn(() => of([]))` infers `Observable<never[]>`, so a later `mockReturnValue` carrying
 * real entries fails `tsc` — invisible under `nx test`, which strips types through esbuild.
 */
const mockDirectoryService = {
  getEntries: vi.fn((): Observable<DirectoryEntry[]> => of([])),
  getAllL10nEntries: vi.fn((_name: string): Observable<L10nDirectoryEntry[]> => of([])),
};

const mockBrowseService = {
  updateDocument: vi.fn(
    (_uid: string, _properties: Record<string, unknown>): Observable<NuxeoDocument> =>
      of(docWith()),
  ),
};

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

interface EditDocumentDialogHarness {
  component: EditDocumentDialogComponent;
  fixture: ComponentFixture<EditDocumentDialogComponent>;
}

async function createDialog(document: NuxeoDocument): Promise<EditDocumentDialogHarness> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [EditDocumentDialogComponent],
    providers: [
      provideZonelessChangeDetection(),
      { provide: MatDialogRef, useValue: mockDialogRef },
      { provide: MAT_DIALOG_DATA, useValue: { document } },
      { provide: DirectoryService, useValue: mockDirectoryService },
      { provide: BrowseService, useValue: mockBrowseService },
    ],
  })
    .overrideComponent(EditDocumentDialogComponent, {
      set: { imports: [], template: '<div></div>' },
    })
    .compileComponents();

  const fixture = TestBed.createComponent(EditDocumentDialogComponent);
  const component = fixture.componentInstance;
  fixture.detectChanges();
  await flushAsync();
  return { component, fixture };
}

describe('EditDocumentDialogComponent', () => {
  let component: EditDocumentDialogComponent;
  let dialogFixture: ComponentFixture<EditDocumentDialogComponent>;

  const fullDocument = docWith({
    uid: 'doc-42',
    title: 'Fallback title',
    properties: {
      'dc:title': 'Quarterly report',
      'dc:description': 'Q3 numbers',
      'dc:nature': 'memo',
      'dc:subjects': ['cinema', 'painting'],
      'dc:coverage': 'tanzania',
      'dc:expired': '2026-12-31T00:00:00.000Z',
    },
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    // `vi.clearAllMocks()` clears call history but NOT an implementation installed by
    // `mockReturnValue`, so anything stubbed in one test leaks into every later one.
    mockDirectoryService.getEntries.mockReturnValue(of(natureEntries));
    mockDirectoryService.getAllL10nEntries.mockImplementation((name: string) =>
      of(name === 'l10nsubjects' ? subjectEntries : coverageEntries),
    );
    mockBrowseService.updateDocument.mockReturnValue(of(docWith({ uid: 'doc-42' })));

    ({ component, fixture: dialogFixture } = await createDialog(fullDocument));
  });

  describe('ngOnInit', () => {
    it('seeds every field from the document properties', () => {
      expect(component.title).toBe('Quarterly report');
      expect(component.description).toBe('Q3 numbers');
      expect(component.nature).toBe('memo');
      expect(component.subjects).toEqual(['cinema', 'painting']);
      expect(component.coverage).toBe('tanzania');
      expect(component.expires?.toISOString()).toBe('2026-12-31T00:00:00.000Z');
    });

    it('loads nature, subjects and coverage vocabularies in one forkJoin', () => {
      expect(mockDirectoryService.getEntries).toHaveBeenCalledWith('nature');
      expect(mockDirectoryService.getAllL10nEntries).toHaveBeenCalledWith('l10nsubjects');
      expect(mockDirectoryService.getAllL10nEntries).toHaveBeenCalledWith('l10ncoverage');

      expect(component.natureEntries().map((e) => e.id)).toEqual(['article', 'memo']);
      // Children must be present, not just top-level parents, or the grouped picker is empty.
      expect(component.subjectEntries().map((e) => e.id)).toContain('cinema');
      expect(component.coverageEntries().map((e) => e.id)).toContain('tanzania');
    });

    it('falls back to doc.title and empty defaults when dc: properties are absent', async () => {
      const { component: bare } = await createDialog(
        docWith({ uid: 'doc-bare', title: 'Untitled note', properties: {} }),
      );

      expect(bare.title).toBe('Untitled note');
      expect(bare.description).toBe('');
      expect(bare.nature).toBeNull();
      expect(bare.subjects).toEqual([]);
      expect(bare.coverage).toBeNull();
      expect(bare.expires).toBeNull();
    });

    it('falls back to an empty title when neither dc:title nor doc.title is set', async () => {
      // `title` is required on `NuxeoDocument`, so it is removed rather than cast: Nuxeo omits
      // it on some proxy and version entries, which is what makes the `?? ''` tail of the
      // chain reachable. `title: ''` would not reach it — '' is not nullish.
      const titleless = docWith({ uid: 'doc-titleless', properties: {} });
      delete (titleless as { title?: string }).title;

      const { component: loaded } = await createDialog(titleless);

      expect(loaded.title).toBe('');
    });

    it('tolerates a document with no properties object at all', async () => {
      // `properties` is required on NuxeoDocument, so this exercises the `?? {}` guard the
      // component keeps for responses that omit it.
      const noProps = docWith({ uid: 'doc-noprops', title: 'No props' });
      delete (noProps as { properties?: Record<string, unknown> }).properties;

      const { component: loaded } = await createDialog(noProps);

      expect(loaded.title).toBe('No props');
      expect(loaded.subjects).toEqual([]);
    });
  });

  describe('nature picker', () => {
    it('refetches nature entries when the panel opens', () => {
      mockDirectoryService.getEntries.mockClear();
      mockDirectoryService.getEntries.mockReturnValue(
        of([directoryEntry({ id: 'report', label: 'Report', displayLabel: 'Report' })]),
      );

      component.onNaturePanelOpen(true);

      expect(mockDirectoryService.getEntries).toHaveBeenCalledWith('nature');
      expect(component.natureEntries().map((e) => e.id)).toEqual(['report']);
    });

    it('clears the search text when the panel closes, without refetching', () => {
      component.naturePanelSearch = 'mem';
      mockDirectoryService.getEntries.mockClear();

      component.onNaturePanelOpen(false);

      expect(component.naturePanelSearch).toBe('');
      expect(mockDirectoryService.getEntries).not.toHaveBeenCalled();
    });

    it('filters nature options by the panel search text', () => {
      expect(component.filteredNatureOptions().map((e) => e.id)).toEqual(['article', 'memo']);

      component.naturePanelSearch = 'mem';

      expect(component.filteredNatureOptions().map((e) => e.id)).toEqual(['memo']);
    });

    it('renders the pill label from the loaded entry', () => {
      expect(component.naturePillLabel('memo')).toBe('Memo');
    });

    it('falls back to the raw id when the entry is not loaded', () => {
      component.natureEntries.set([]);
      expect(component.naturePillLabel('memo')).toBe('memo');
    });

    it('clears the selected nature', () => {
      expect(component.nature).toBe('memo');
      component.clearNature();
      expect(component.nature).toBeNull();
    });
  });

  describe('subjects picker', () => {
    it('groups children under their parent label', () => {
      const groups = component.groupedSubjectOptions();
      expect(groups).toHaveLength(1);
      expect(groups[0].parentLabel).toBe('Art');
      expect(groups[0].entries.map((e) => e.id)).toEqual(['cinema', 'painting']);
    });

    it('narrows the groups by the panel search text', () => {
      component.subjectsPanelSearch = 'cin';
      const groups = component.groupedSubjectOptions();
      expect(groups).toHaveLength(1);
      expect(groups[0].entries.map((e) => e.id)).toEqual(['cinema']);
    });

    it('reloads subject entries when the panel opens', () => {
      mockDirectoryService.getAllL10nEntries.mockClear();

      component.onSubjectsPanelOpen(true);

      expect(mockDirectoryService.getAllL10nEntries).toHaveBeenCalledWith('l10nsubjects');
      expect(component.subjectEntries().map((e) => e.id)).toContain('cinema');
    });

    it('clears the subjects search on close without refetching', () => {
      component.subjectsPanelSearch = 'cin';
      mockDirectoryService.getAllL10nEntries.mockClear();

      component.onSubjectsPanelOpen(false);

      expect(component.subjectsPanelSearch).toBe('');
      expect(mockDirectoryService.getAllL10nEntries).not.toHaveBeenCalled();
    });

    it('renders a child subject as Parent/Child', () => {
      expect(component.subjectPillLabel('cinema')).toBe('Art/Cinema');
    });

    it('removes one subject and leaves the others', () => {
      component.subjects = ['cinema', 'painting'];
      component.removeSubject('cinema');
      expect(component.subjects).toEqual(['painting']);
    });
  });

  describe('coverage picker', () => {
    it('groups coverage children under their parent label', () => {
      const groups = component.groupedCoverageOptions();
      expect(groups).toHaveLength(1);
      expect(groups[0].parentLabel).toBe('Africa');
      expect(groups[0].entries.map((e) => e.id)).toEqual(['tanzania']);
    });

    it('reloads coverage entries when the panel opens', () => {
      mockDirectoryService.getAllL10nEntries.mockClear();

      component.onCoveragePanelOpen(true);

      expect(mockDirectoryService.getAllL10nEntries).toHaveBeenCalledWith('l10ncoverage');
      expect(component.coverageEntries().map((e) => e.id)).toContain('tanzania');
    });

    it('clears the coverage search on close without refetching', () => {
      component.coveragePanelSearch = 'afr';
      mockDirectoryService.getAllL10nEntries.mockClear();

      component.onCoveragePanelOpen(false);

      expect(component.coveragePanelSearch).toBe('');
      expect(mockDirectoryService.getAllL10nEntries).not.toHaveBeenCalled();
    });

    it('renders the selected child coverage as Parent/Child', () => {
      expect(component.coveragePillLabel('tanzania')).toBe('Africa/Tanzania');
    });

    it('clears the selected coverage', () => {
      expect(component.coverage).toBe('tanzania');
      component.clearCoverage();
      expect(component.coverage).toBeNull();
    });
  });

  it.each([
    { locale: enUS, input: '12/31/2026' },
    { locale: fr, input: '31/12/2026' },
    { locale: de, input: '31.12.2026' },
    { locale: nl, input: '31-12-2026' },
    { locale: ja, input: '2026/12/31' },
    { locale: th, input: '31/12/2026' },
    { locale: zhCN, input: '26-12-31' },
  ])(
    'accepts Expires "$input" using $locale.code and retains the parsed date',
    ({ locale, input }) => {
      dialogFixture.debugElement.injector.get<DateAdapter<Date>>(DateAdapter).setLocale(locale);
      component.onExpiresInput({ target: { value: input } } as unknown as Event);
      expect(component.isExpiresValid()).toBe(true);
      expect(component.showExpiresError()).toBe(false);
      expect(component.expiresErrorMatcher.isErrorState()).toBe(false);
      expect([
        component.expires?.getFullYear(),
        component.expires?.getMonth(),
        component.expires?.getDate(),
      ]).toEqual([2026, 11, 31]);
      component.save();
      expect(mockBrowseService.updateDocument).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ 'dc:expired': new Date(2026, 11, 31).toISOString() }),
      );
    },
  );

  it('shows and blocks locale-invalid Expires text even when the model previously held a valid date', () => {
    dialogFixture.debugElement.injector.get<DateAdapter<Date>>(DateAdapter).setLocale(de);
    component.expires = new Date(2026, 3, 3);
    component.onExpiresInput({ target: { value: '03/04/2026' } } as unknown as Event);
    expect(component.isExpiresValid()).toBe(false);
    expect(component.showExpiresError()).toBe(true);
    expect(component.expiresErrorMatcher.isErrorState()).toBe(true);
    // Material's ngModel turns an invalid adapter date into null. Non-empty raw text must
    // still block submission rather than clearing the stored expiry.
    component.onExpiresChange(null);
    expect(component.isExpiresValid()).toBe(false);
    component.save();
    expect(mockBrowseService.updateDocument).not.toHaveBeenCalled();
  });

  describe('expires field', () => {
    it('accepts an empty value as valid', () => {
      component.expiresRawText = '';
      component.expires = null;
      expect(component.isExpiresValid()).toBe(true);
      expect(component.showExpiresError()).toBe(false);
    });

    it('accepts a fully typed valid date', () => {
      component.onExpiresInput({ target: { value: '12/31/2026' } } as unknown as Event);
      expect(component.isExpiresValid()).toBe(true);
      expect(component.showExpiresError()).toBe(false);
    });

    it('treats unparseable text as invalid and shows the error', () => {
      component.expiresRawText = 'not-a-date';
      component.expires = null;
      expect(component.isExpiresValid()).toBe(false);
      expect(component.showExpiresError()).toBe(true);
    });

    it('reports the datepicker error state through the errorStateMatcher', () => {
      component.expiresRawText = 'not-a-date';
      expect(component.expiresErrorMatcher.isErrorState()).toBe(true);

      component.expiresRawText = '';
      expect(component.expiresErrorMatcher.isErrorState()).toBe(false);
    });

    it('records raw input and marks the control dirty and touched', () => {
      const control = {
        markAsDirty: vi.fn(),
        markAsTouched: vi.fn(),
        updateValueAndValidity: vi.fn(),
      };
      (component as unknown as { expiresNgModel: unknown }).expiresNgModel = { control };

      component.onExpiresInput({ target: { value: '12/31/2026' } } as unknown as Event);

      expect(component.expiresRawText).toBe('12/31/2026');
      expect(control.markAsDirty).toHaveBeenCalled();
      expect(control.markAsTouched).toHaveBeenCalled();
      // `emitEvent: false` matters — re-emitting re-enters this same handler.
      expect(control.updateValueAndValidity).toHaveBeenCalledWith({ emitEvent: false });
    });

    it('does not throw when the ngModel control is not resolved yet', () => {
      (component as unknown as { expiresNgModel: unknown }).expiresNgModel = undefined;

      expect(() =>
        component.onExpiresInput({ target: { value: '01/02/2027' } } as unknown as Event),
      ).not.toThrow();
      expect(component.expiresRawText).toBe('01/02/2027');
    });

    it('clears the raw text once a real date is picked', () => {
      component.expiresRawText = 'partially typed';
      component.onExpiresChange(new Date('2026-12-31T00:00:00.000Z'));
      expect(component.expires?.toISOString()).toBe('2026-12-31T00:00:00.000Z');
      expect(component.expiresRawText).toBe('');
    });

    it('keeps the raw text when the picked date is unusable', () => {
      component.expiresRawText = 'partially typed';
      component.onExpiresChange(new Date('nonsense'));
      // Clearing here would discard what the user typed in favour of an Invalid Date.
      expect(component.expiresRawText).toBe('partially typed');
    });

    it('keeps the raw text when the date is cleared', () => {
      component.expiresRawText = 'partially typed';
      component.onExpiresChange(null);
      expect(component.expires).toBeNull();
      expect(component.expiresRawText).toBe('partially typed');
    });
  });

  describe('save', () => {
    beforeEach(() => {
      component.title = 'Quarterly report';
      component.description = '';
      component.nature = null;
      component.subjects = [];
      component.coverage = null;
      component.expires = null;
      component.expiresRawText = '';
      component.saving.set(false);
    });

    it('sends trimmed values and nulls for the empty optional fields', () => {
      component.title = '  Spaced  ';
      component.description = '   ';

      component.save();

      expect(mockBrowseService.updateDocument).toHaveBeenCalledWith('doc-42', {
        'dc:title': 'Spaced',
        // Empty optional text must be null, not '' — an empty string is a value Nuxeo stores.
        'dc:description': null,
        'dc:nature': null,
        'dc:subjects': [],
        'dc:coverage': null,
        'dc:expired': null,
      });
    });

    it('sends the selected vocabulary values as-is', () => {
      component.description = 'Q3 numbers';
      component.nature = 'memo';
      component.subjects = ['cinema', 'painting'];
      component.coverage = 'tanzania';

      component.save();

      expect(mockBrowseService.updateDocument).toHaveBeenCalledWith('doc-42', {
        'dc:title': 'Quarterly report',
        'dc:description': 'Q3 numbers',
        'dc:nature': 'memo',
        'dc:subjects': ['cinema', 'painting'],
        'dc:coverage': 'tanzania',
        'dc:expired': null,
      });
    });

    it('serialises a valid expiry as an ISO string', () => {
      component.expires = new Date('2026-12-31T00:00:00.000Z');

      component.save();

      const properties = mockBrowseService.updateDocument.mock.calls[0][1];
      expect(properties['dc:expired']).toBe('2026-12-31T00:00:00.000Z');
    });

    /**
     * The `!Number.isNaN(...)` ternary on `dc:expired` (edit-document-dialog.ts:523) cannot be
     * reached with an Invalid Date through `save()`: the `!this.isExpiresValid()` guard on line
     * 513 rejects it first and returns before any payload is built. The ternary is
     * belt-and-braces, not the thing that prevents a `RangeError` — the guard is. Asserting the
     * guard is therefore the real behaviour; left as-is because the redundancy is harmless.
     */
    it('refuses to save an invalid expiry date, before building any payload', () => {
      component.expires = new Date('nonsense');

      component.save();

      expect(component.isExpiresValid()).toBe(false);
      expect(mockBrowseService.updateDocument).not.toHaveBeenCalled();
      expect(component.saving()).toBe(false);
    });

    it('closes with the updated document on success and releases the saving flag', () => {
      const updated = docWith({ uid: 'doc-42', title: 'Quarterly report' });
      mockBrowseService.updateDocument.mockReturnValue(of(updated));

      component.save();

      expect(mockDialogRef.close).toHaveBeenCalledWith(updated);
      expect(component.saving()).toBe(false);
    });

    it('releases the saving flag and stays open on failure', () => {
      mockBrowseService.updateDocument.mockReturnValue(throwError(() => new Error('conflict')));

      component.save();

      // Leaving `saving` true would disable the Save button permanently, stranding the user
      // with unsaved edits and no way to retry.
      expect(component.saving()).toBe(false);
      expect(mockDialogRef.close).not.toHaveBeenCalled();
    });

    it('refuses to save an empty or whitespace-only title', () => {
      component.title = '   ';
      component.save();
      expect(mockBrowseService.updateDocument).not.toHaveBeenCalled();
    });

    it('refuses to save while a save is already in flight', () => {
      component.saving.set(true);
      component.save();
      expect(mockBrowseService.updateDocument).not.toHaveBeenCalled();
    });

    it('refuses to save while the expiry field text is invalid', () => {
      component.expiresRawText = 'not-a-date';
      component.save();
      expect(mockBrowseService.updateDocument).not.toHaveBeenCalled();
    });
  });
});

/** Types `text` one keystroke at a time with change detection after each, as a browser does. */
async function typeKeystrokes(
  fixture: ComponentFixture<unknown>,
  input: HTMLInputElement,
  text: string,
): Promise<string[]> {
  const shown: string[] = [];
  for (let end = 1; end <= text.length; end++) {
    input.value = text.slice(0, end);
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();
    shown.push(input.value);
  }
  return shown;
}

const TYPED_EXPIRY = '12/31/2027';
const TYPED_PREFIXES = [...TYPED_EXPIRY].map((_, index) => TYPED_EXPIRY.slice(0, index + 1));
const dayOf = (date: Date | null) => date && [date.getFullYear(), date.getMonth(), date.getDate()];

// Material keeps null for a partial date; a handler that stored anything else made [ngModel]
// write back and erase the text mid-entry. Only a real template exercises that write-back.
describe('EditDocumentDialogComponent Expires typed into the real field', () => {
  it('keeps every partial entry in the field and holds the finished date', async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [testTranslateModule(), EditDocumentDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
        { provide: MAT_DIALOG_DATA, useValue: { document: docWith() } },
        { provide: DirectoryService, useValue: mockDirectoryService },
        { provide: BrowseService, useValue: mockBrowseService },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(EditDocumentDialogComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const input = fixture.nativeElement.querySelector('input[name="expires"]') as HTMLInputElement;

    expect(await typeKeystrokes(fixture, input, TYPED_EXPIRY)).toEqual(TYPED_PREFIXES);
    expect(dayOf(fixture.componentInstance.expires)).toEqual([2027, 11, 31]);
  });
});
