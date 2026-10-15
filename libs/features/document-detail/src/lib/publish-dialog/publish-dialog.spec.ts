import { ComponentFixture, TestBed } from '@angular/core/testing';
import { testTranslateModule } from '@agentic-ui/testing/i18n';
import { provideZonelessChangeDetection } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of, throwError, type Observable } from 'rxjs';
import { vi } from 'vitest';

import {
  DocumentDetailService,
  type NuxeoDocument,
  type NuxeoDocumentList,
} from '@nuxeo/satori-platform/nuxeo-client';

import { PublishDialogComponent, type PublishDialogData } from './publish-dialog';

function docWith(overrides: Partial<NuxeoDocument> = {}): NuxeoDocument {
  return {
    uid: 'doc-1',
    title: 'Doc',
    type: 'File',
    path: '/default-domain/workspaces/ws/doc',
    lastModified: '2026-08-01T00:00:00.000Z',
    properties: {},
    ...overrides,
  };
}

function section(uid: string, path: string, title: string): NuxeoDocument {
  return docWith({ uid, path, title, type: 'Section' });
}

function documentList(entries: NuxeoDocument[]): NuxeoDocumentList {
  return {
    entries,
    totalSize: entries.length,
    resultsCount: entries.length,
    currentPageSize: entries.length,
    currentPageIndex: 0,
    numberOfPages: 1,
    isNextPageAvailable: false,
  };
}

/**
 * A section root, a child, a grandchild, and a second root under a different domain.
 *
 * The second root matters: `flattenSections` decides root-ness by whether the parent *path* is
 * itself in the result set, so a tree whose only root is the first entry would not distinguish
 * "root" from "first".
 */
const sectionTree: NuxeoDocument[] = [
  section('sec-root', '/default-domain/sections', 'Sections'),
  section('sec-news', '/default-domain/sections/news', 'News'),
  section('sec-2026', '/default-domain/sections/news/2026', '2026'),
  section('sec-other', '/other-domain/sections', 'Other Sections'),
];

const mockDialogRef = {
  close: vi.fn(),
};

const mockSnackBar = {
  open: vi.fn(),
};

// Full surface up front with explicit return types: `of({...})` would infer a narrower type
// than `NuxeoDocumentList`, and `mockReturnValue` in a later test would fail `tsc` while
// `nx test` stayed green (esbuild strips types).
const mockDetailService = {
  getSectionTree: vi.fn((): Observable<NuxeoDocumentList> => of(documentList([]))),
  publishDocument: vi.fn(
    (
      _uid: string,
      _targetSectionId: string,
      _options?: { override?: boolean; renditionName?: string; defaultRendition?: boolean },
    ): Observable<NuxeoDocument> => of(docWith()),
  ),
};

const dialogData: PublishDialogData = {
  documentUid: 'doc-1',
  documentTitle: 'Quarterly report',
  versionLabel: '1.2',
  renditions: [
    { name: 'pdf', label: 'PDF' },
    { name: 'thumb', label: 'Thumbnail' },
  ],
  versions: [
    docWith({ uid: 'ver-1', properties: { 'uid:major_version': 1, 'uid:minor_version': 1 } }),
    docWith({ uid: 'ver-2', properties: { 'uid:major_version': 1, 'uid:minor_version': 0 } }),
  ],
};

async function createDialog(): Promise<{
  component: PublishDialogComponent;
  fixture: ComponentFixture<PublishDialogComponent>;
}> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [testTranslateModule(), testTranslateModule(), PublishDialogComponent],
    providers: [
      provideZonelessChangeDetection(),
      { provide: MatDialogRef, useValue: mockDialogRef },
      { provide: MAT_DIALOG_DATA, useValue: dialogData },
      { provide: DocumentDetailService, useValue: mockDetailService },
      { provide: MatSnackBar, useValue: mockSnackBar },
    ],
  })
    .overrideComponent(PublishDialogComponent, {
      set: { imports: [], template: '<div></div>' },
    })
    .compileComponents();

  const fixture = TestBed.createComponent(PublishDialogComponent);
  const component = fixture.componentInstance;
  fixture.detectChanges();
  return { component, fixture };
}

describe('PublishDialogComponent', () => {
  let component: PublishDialogComponent;

  beforeEach(async () => {
    vi.clearAllMocks();
    // `vi.clearAllMocks()` clears call history but NOT `mockReturnValue` implementations, so
    // an error observable stubbed in one test would otherwise leak into every later test.
    mockDetailService.getSectionTree.mockReturnValue(of(documentList(sectionTree)));
    mockDetailService.publishDocument.mockReturnValue(of(docWith({ uid: 'proxy-1' })));

    ({ component } = await createDialog());
  });

  describe('ngOnInit', () => {
    it('preselects the live version label', () => {
      expect(component.selectedVersion).toBe('1.2');
    });

    it('flattens the section tree with one depth level per path segment', () => {
      expect(mockDetailService.getSectionTree).toHaveBeenCalled();
      expect(component.flatSections()).toEqual([
        { uid: 'sec-root', title: 'Sections', depth: 0 },
        { uid: 'sec-news', title: 'News', depth: 1 },
        { uid: 'sec-2026', title: '2026', depth: 2 },
        { uid: 'sec-other', title: 'Other Sections', depth: 0 },
      ]);
      expect(component.sectionsLoading()).toBe(false);
    });

    it('releases the loading flag when the section tree fails to load', async () => {
      // The success case above proves `flatSections` can be populated, so an empty list here
      // is a real assertion about the error path rather than an assertion about nothing.
      mockDetailService.getSectionTree.mockReturnValue(throwError(() => new Error('boom')));

      const { component: failed } = await createDialog();

      // A stuck spinner leaves no way to pick a section and no way to publish.
      expect(failed.sectionsLoading()).toBe(false);
      expect(failed.flatSections()).toEqual([]);
    });
  });

  describe('display helpers', () => {
    it('indents by two non-breaking spaces per depth level', () => {
      expect(component.sectionIndent(0)).toBe('');
      // Non-breaking, not ordinary spaces: a native <option> collapses ordinary leading
      // whitespace, so the section tree would render flat.
      expect(component.sectionIndent(1)).toBe('\u00A0\u00A0');
      expect(component.sectionIndent(2)).toBe('\u00A0\u00A0\u00A0\u00A0');
    });

    it('formats a version as major.minor', () => {
      expect(
        component.versionStr(
          docWith({ properties: { 'uid:major_version': 2, 'uid:minor_version': 3 } }),
        ),
      ).toBe('2.3');
    });

    it('falls back to 0.0 when the version properties are missing', () => {
      expect(component.versionStr(docWith({ properties: {} }))).toBe('0.0');
    });
  });

  it('closes without a result when cancelled', () => {
    component.close();
    expect(mockDialogRef.close).toHaveBeenCalledWith();
  });

  describe('publish', () => {
    beforeEach(() => {
      component.selectedSectionId = 'sec-news';
      component.showRenditions = false;
      component.selectedRendition = '';
      component.overrideExisting = false;
      component.publishing.set(false);
    });

    it('refuses to publish with no section chosen', () => {
      component.selectedSectionId = '';
      component.publish();
      expect(mockDetailService.publishDocument).not.toHaveBeenCalled();
    });

    it('refuses to publish while a publish is already in flight', () => {
      component.publishing.set(true);
      component.publish();
      expect(mockDetailService.publishDocument).not.toHaveBeenCalled();
    });

    it('publishes to the chosen section with no rendition by default', () => {
      component.publish();

      expect(mockDetailService.publishDocument).toHaveBeenCalledWith('doc-1', 'sec-news', {
        override: false,
        renditionName: undefined,
        defaultRendition: false,
      });
    });

    it('forwards the override flag', () => {
      component.overrideExisting = true;

      component.publish();

      const [, , options] = mockDetailService.publishDocument.mock.calls[0];
      expect(options?.override).toBe(true);
    });

    it('sends the named rendition when renditions are shown', () => {
      component.showRenditions = true;
      component.selectedRendition = 'pdf';

      component.publish();

      const [, , options] = mockDetailService.publishDocument.mock.calls[0];
      expect(options?.renditionName).toBe('pdf');
      expect(options?.defaultRendition).toBe(false);
    });

    it('asks for the default rendition rather than a named one for __default__', () => {
      component.showRenditions = true;
      component.selectedRendition = '__default__';

      component.publish();

      const [, , options] = mockDetailService.publishDocument.mock.calls[0];
      expect(options?.renditionName).toBeUndefined();
      expect(options?.defaultRendition).toBe(true);
    });

    it('ignores a rendition chosen before the renditions checkbox was ticked', () => {
      // The select keeps its value when `showRenditions` is unticked, so publishing must not
      // silently apply a rendition the user can no longer see.
      component.showRenditions = false;
      component.selectedRendition = 'pdf';

      component.publish();

      const [, , options] = mockDetailService.publishDocument.mock.calls[0];
      expect(options?.renditionName).toBeUndefined();
      expect(options?.defaultRendition).toBe(false);
    });

    it('treats an explicitly empty rendition as none', () => {
      component.showRenditions = true;
      component.selectedRendition = '';

      component.publish();

      const [, , options] = mockDetailService.publishDocument.mock.calls[0];
      expect(options?.renditionName).toBeUndefined();
      expect(options?.defaultRendition).toBe(false);
    });

    it('confirms with the document title and closes with true on success', () => {
      component.publish();

      expect(mockSnackBar.open).toHaveBeenCalledWith(
        '"Quarterly report" published successfully',
        'OK',
        { duration: 3000 },
      );
      expect(mockDialogRef.close).toHaveBeenCalledWith(true);
      expect(component.publishing()).toBe(false);
    });

    it('reports the failure, releases the publishing flag and stays open', () => {
      mockDetailService.publishDocument.mockReturnValue(throwError(() => new Error('403')));

      component.publish();

      // Leaving `publishing` true disables the Publish button for good, with no way to retry.
      expect(component.publishing()).toBe(false);
      expect(mockSnackBar.open).toHaveBeenCalledWith('Failed to publish document', 'OK', {
        duration: 3000,
      });
      expect(mockDialogRef.close).not.toHaveBeenCalled();
    });
  });
});
