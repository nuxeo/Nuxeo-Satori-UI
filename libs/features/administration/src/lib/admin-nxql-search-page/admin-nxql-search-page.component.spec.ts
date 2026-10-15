import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal, type WritableSignal } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { of, throwError } from 'rxjs';

import { AdminNxqlSearchPageComponent } from './admin-nxql-search-page.component';
import { AdministrationService, NuxeoDocument } from '@nuxeo/satori-platform/nuxeo-client';
import { AiGatewayService, AiFeatureFlagService } from '@agentic-ui/shared/ai-client';
import { testTranslateModule } from '@agentic-ui/testing/i18n';

const DEFAULT_NXQL =
  "SELECT * FROM Document WHERE ecm:mixinType != 'HiddenInNavigation' AND ecm:isProxy = 0 " +
  'AND ecm:isVersion = 0 AND ecm:isTrashed = 0';

describe('AdminNxqlSearchPageComponent', () => {
  let component: AdminNxqlSearchPageComponent;
  let fixture: ComponentFixture<AdminNxqlSearchPageComponent>;

  const mockAdminService = {
    nxqlSearch: vi.fn(),
  };

  const mockAiGatewayService = {
    nlToNxql: vi.fn(),
  };

  /**
   * `AiFeatureFlagService` exposes `aiEnabled` as a signal, and the template gates the whole AI row
   * on `featureFlags.aiEnabled()`.
   *
   * This was previously mocked as `{ nlToNxqlEnabled: vi.fn(() => true) }` — a method that exists
   * nowhere in the codebase. Nothing caught it because no test in this file rendered the template,
   * so the invalid provider was never resolved. The render assertions below are what make the gate
   * real: they fail if the flag is mocked with the wrong shape.
   */
  let aiEnabled: WritableSignal<boolean>;

  beforeEach(() => {
    aiEnabled = signal(true);

    TestBed.configureTestingModule({
      // The real English catalogue, because the assertions below render a template full of
      // `| translate`. A `{ instant: key => key }` stub has no `get()` and no change streams.
      imports: [AdminNxqlSearchPageComponent, NoopAnimationsModule, testTranslateModule()],
      providers: [
        provideZonelessChangeDetection(),
        { provide: AdministrationService, useValue: mockAdminService },
        { provide: AiGatewayService, useValue: mockAiGatewayService },
        { provide: AiFeatureFlagService, useValue: { aiEnabled } },
      ],
    });

    fixture = TestBed.createComponent(AdminNxqlSearchPageComponent);
    component = fixture.componentInstance;

    vi.clearAllMocks();

    // `clearAllMocks` resets recorded calls but keeps implementations, so a `mockReturnValue` set
    // inside one test survives into the next. Without these defaults, tests that call `runSearch()`
    // without arranging `nxqlSearch` only passed because an earlier test had arranged it — run in
    // isolation the mock returned `undefined` and the component could not subscribe. Re-stating the
    // defaults here makes every test independent of the order it runs in.
    mockAdminService.nxqlSearch.mockReturnValue(of({ entries: [], totalSize: 0 }));
    mockAiGatewayService.nlToNxql.mockReturnValue(of({ nxql: '', explanation: '' }));
  });

  describe('the AI feature gate', () => {
    /** The natural-language row, which the template wraps in `@if (featureFlags.aiEnabled())`. */
    function aiRow(): Element | null {
      return (fixture.nativeElement as HTMLElement).querySelector('.ai-generate-row');
    }

    it('renders the natural-language row when AI is enabled', () => {
      aiEnabled.set(true);

      fixture.detectChanges();

      expect(aiRow()).not.toBeNull();
    });

    it('renders no natural-language row when AI is disabled', () => {
      aiEnabled.set(false);

      fixture.detectChanges();

      // The discriminating half: without it, a template that dropped the `@if` entirely would
      // still satisfy the enabled case above.
      expect(aiRow()).toBeNull();
    });

    it('renders the query editor either way', () => {
      aiEnabled.set(false);

      fixture.detectChanges();

      // The gate hides only the AI affordance, not the page.
      expect((fixture.nativeElement as HTMLElement).querySelector('.nxql-field')).not.toBeNull();
    });
  });

  describe('component creation', () => {
    it('should create', () => {
      expect(component).toBeTruthy();
    });

    it('should initialize with DEFAULT_NXQL query', () => {
      expect(component.queryText).toBe(DEFAULT_NXQL);
    });

    it('should initialize with empty results', () => {
      expect(component.results()).toEqual([]);
    });

    it('should initialize with totalSize of 0', () => {
      expect(component.totalSize()).toBe(0);
    });

    it('should initialize with loading false', () => {
      expect(component.loading()).toBe(false);
    });

    it('should initialize with no error', () => {
      expect(component.error()).toBeNull();
    });

    it('should initialize with empty aiNlQuery', () => {
      expect(component.aiNlQuery).toBe('');
    });

    it('should initialize with aiGenerating false', () => {
      expect(component.aiGenerating()).toBe(false);
    });

    it('should initialize with no aiGenError', () => {
      expect(component.aiGenError()).toBeNull();
    });

    it('should have correct column configuration', () => {
      expect(component.columns).toEqual(['path', 'type', 'size', 'modified', 'contributor']);
    });
  });

  describe('runSearch', () => {
    const mockDocuments: NuxeoDocument[] = [
      {
        uid: 'doc1',
        title: 'Test Document',
        path: '/default-domain/workspaces/test',
        type: 'File',
        lastModified: '2026-09-21T10:00:00Z',
        properties: {
          'dc:title': 'Test Document',
          'dc:modified': '2026-09-22T10:00:00Z',
          'dc:lastContributor': 'testuser',
          'file:content': { length: '2048' },
        },
      },
      {
        uid: 'doc2',
        title: 'Test Folder',
        path: '/default-domain/workspaces/test2',
        type: 'Folder',
        lastModified: '2026-09-21T10:00:00Z',
        properties: {
          'dc:title': 'Test Folder',
          'dc:modified': '2026-09-21T10:00:00Z',
          'dc:creator': 'admin',
        },
      },
    ];

    // Note: loading state is transient and completes synchronously with of() observables
    // Tested implicitly by other tests that verify final state

    it('should clear error when starting new search', () => {
      component.error.set('previous error');
      mockAdminService.nxqlSearch.mockReturnValue(of({ entries: [], totalSize: 0 }));
      component.runSearch();
      expect(component.error()).toBeNull();
    });

    it('should trim query text before executing search', () => {
      component.queryText = '  SELECT * FROM Document  ';
      mockAdminService.nxqlSearch.mockReturnValue(of({ entries: [], totalSize: 0 }));
      component.runSearch();
      expect(mockAdminService.nxqlSearch).toHaveBeenCalledWith('SELECT * FROM Document', 100, 0);
    });

    it('should call adminService.nxqlSearch with correct parameters', () => {
      mockAdminService.nxqlSearch.mockReturnValue(of({ entries: [], totalSize: 0 }));
      component.runSearch();
      expect(mockAdminService.nxqlSearch).toHaveBeenCalledWith(DEFAULT_NXQL, 100, 0);
    });

    it('should populate results and totalSize on successful search', () => {
      mockAdminService.nxqlSearch.mockReturnValue(of({ entries: mockDocuments, totalSize: 2 }));
      component.runSearch();
      expect(component.results()).toEqual(mockDocuments);
      expect(component.totalSize()).toBe(2);
    });

    it('should set loading to false after successful search', () => {
      mockAdminService.nxqlSearch.mockReturnValue(of({ entries: mockDocuments, totalSize: 2 }));
      component.runSearch();
      expect(component.loading()).toBe(false);
    });

    it('should handle missing entries in search response', () => {
      mockAdminService.nxqlSearch.mockReturnValue(of({ totalSize: 0 }));
      component.runSearch();
      expect(component.results()).toEqual([]);
      expect(component.totalSize()).toBe(0);
    });

    it('should use entries.length as fallback when totalSize is missing', () => {
      mockAdminService.nxqlSearch.mockReturnValue(of({ entries: mockDocuments }));
      component.runSearch();
      expect(component.totalSize()).toBe(2);
    });

    it('should use 0 as fallback when both totalSize and entries are missing', () => {
      mockAdminService.nxqlSearch.mockReturnValue(of({}));
      component.runSearch();
      expect(component.totalSize()).toBe(0);
    });

    it('should handle search error and set error signal', () => {
      const errorMessage = 'Search failed';
      mockAdminService.nxqlSearch.mockReturnValue(throwError(() => ({ message: errorMessage })));
      component.runSearch();
      expect(component.error()).toBe(errorMessage);
    });

    it('should use translated message when error has no message', () => {
      mockAdminService.nxqlSearch.mockReturnValue(throwError(() => ({})));
      component.runSearch();
      // The English the real catalogue serves for `admin.message.query-failed`, so this asserts
      // what a user reads rather than the key a developer typed.
      expect(component.error()).toBe('Query failed.');
    });

    it('should clear results when search fails', () => {
      component.results.set(mockDocuments);
      mockAdminService.nxqlSearch.mockReturnValue(throwError(() => ({ message: 'Error' })));
      component.runSearch();
      expect(component.results()).toEqual([]);
    });

    it('should clear totalSize when search fails', () => {
      component.totalSize.set(10);
      mockAdminService.nxqlSearch.mockReturnValue(throwError(() => ({ message: 'Error' })));
      component.runSearch();
      expect(component.totalSize()).toBe(0);
    });

    it('should set loading to false after search error', () => {
      mockAdminService.nxqlSearch.mockReturnValue(throwError(() => ({ message: 'Error' })));
      component.runSearch();
      expect(component.loading()).toBe(false);
    });
  });

  describe('clear', () => {
    it('should reset queryText to DEFAULT_NXQL', () => {
      component.queryText = 'SELECT * FROM File';
      component.clear();
      expect(component.queryText).toBe(DEFAULT_NXQL);
    });

    it('should not affect other component state', () => {
      component.results.set([
        {
          uid: 'doc1',
          title: 'Test Document',
          path: '/test',
          type: 'File',
          lastModified: '2026-09-21T10:00:00Z',
          properties: {},
        },
      ]);
      component.totalSize.set(1);
      component.clear();
      expect(component.results()).toHaveLength(1);
      expect(component.totalSize()).toBe(1);
    });
  });

  describe('formatSize', () => {
    it('should return "—" when document has no file:content', () => {
      const doc: NuxeoDocument = {
        uid: 'doc1',
        title: 'Test Document',
        path: '/test',
        type: 'File',
        lastModified: '2026-09-21T10:00:00Z',
        properties: {},
      };
      expect(component.formatSize(doc)).toBe('—');
    });

    it('should return "—" when file:content has no length', () => {
      const doc: NuxeoDocument = {
        uid: 'doc1',
        title: 'Test Document',
        path: '/test',
        type: 'File',
        lastModified: '2026-09-21T10:00:00Z',
        properties: {
          'file:content': {},
        },
      };
      expect(component.formatSize(doc)).toBe('—');
    });

    it('should format bytes correctly when size < 1024', () => {
      const doc: NuxeoDocument = {
        uid: 'doc1',
        title: 'Test Document',
        path: '/test',
        type: 'File',
        lastModified: '2026-09-21T10:00:00Z',
        properties: {
          'file:content': { length: '512' },
        },
      };
      expect(component.formatSize(doc)).toBe('512 B');
    });

    it('should format kilobytes correctly when size < 1MB', () => {
      const doc: NuxeoDocument = {
        uid: 'doc1',
        title: 'Test Document',
        path: '/test',
        type: 'File',
        lastModified: '2026-09-21T10:00:00Z',
        properties: {
          'file:content': { length: '2048' },
        },
      };
      expect(component.formatSize(doc)).toBe('2.00 KB');
    });

    it('should format megabytes correctly when size >= 1MB', () => {
      const doc: NuxeoDocument = {
        uid: 'doc1',
        title: 'Test Document',
        path: '/test',
        type: 'File',
        lastModified: '2026-09-21T10:00:00Z',
        properties: {
          'file:content': { length: '2097152' },
        },
      };
      expect(component.formatSize(doc)).toBe('2.00 MB');
    });

    it('should handle NaN file sizes gracefully', () => {
      const doc: NuxeoDocument = {
        uid: 'doc1',
        title: 'Test Document',
        path: '/test',
        type: 'File',
        lastModified: '2026-09-21T10:00:00Z',
        properties: {
          'file:content': { length: 'invalid' },
        },
      };
      expect(component.formatSize(doc)).toBe('invalid');
    });

    it('should handle zero size', () => {
      const doc: NuxeoDocument = {
        uid: 'doc1',
        title: 'Test Document',
        path: '/test',
        type: 'File',
        lastModified: '2026-09-21T10:00:00Z',
        properties: {
          'file:content': { length: '0' },
        },
      };
      expect(component.formatSize(doc)).toBe('0 B');
    });

    it('should handle boundary value at 1024 bytes', () => {
      const doc: NuxeoDocument = {
        uid: 'doc1',
        title: 'Test Document',
        path: '/test',
        type: 'File',
        lastModified: '2026-09-21T10:00:00Z',
        properties: {
          'file:content': { length: '1024' },
        },
      };
      expect(component.formatSize(doc)).toBe('1.00 KB');
    });

    it('should handle boundary value at 1MB', () => {
      const doc: NuxeoDocument = {
        uid: 'doc1',
        title: 'Test Document',
        path: '/test',
        type: 'File',
        lastModified: '2026-09-21T10:00:00Z',
        properties: {
          'file:content': { length: '1048576' },
        },
      };
      expect(component.formatSize(doc)).toBe('1.00 MB');
    });

    it('should handle large file sizes', () => {
      const doc: NuxeoDocument = {
        uid: 'doc1',
        title: 'Test Document',
        path: '/test',
        type: 'File',
        lastModified: '2026-09-21T10:00:00Z',
        properties: {
          'file:content': { length: '104857600' },
        },
      };
      expect(component.formatSize(doc)).toBe('100.00 MB');
    });
  });

  describe('lastContributor', () => {
    it('should extract dc:lastContributor from document properties', () => {
      const doc: NuxeoDocument = {
        uid: 'doc1',
        title: 'Test Document',
        path: '/test',
        type: 'File',
        lastModified: '2026-09-21T10:00:00Z',
        properties: {
          'dc:lastContributor': 'testuser',
          'dc:creator': 'admin',
        },
      };
      expect(component.lastContributor(doc)).toBe('testuser');
    });

    it('should fallback to dc:creator if dc:lastContributor is missing', () => {
      const doc: NuxeoDocument = {
        uid: 'doc1',
        title: 'Test Document',
        path: '/test',
        type: 'File',
        lastModified: '2026-09-21T10:00:00Z',
        properties: {
          'dc:creator': 'admin',
        },
      };
      expect(component.lastContributor(doc)).toBe('admin');
    });

    it('should return "—" if both contributor fields are missing', () => {
      const doc: NuxeoDocument = {
        uid: 'doc1',
        title: 'Test Document',
        path: '/test',
        type: 'File',
        lastModified: '2026-09-21T10:00:00Z',
        properties: {},
      };
      expect(component.lastContributor(doc)).toBe('—');
    });

    it('should return "—" if properties is undefined', () => {
      // `NuxeoDocument.properties` is declared required, so this shape is off-type on purpose: it
      // pins the `?.` the component uses for a response that omitted the block entirely.
      const doc = {
        uid: 'doc1',
        title: 'Test Document',
        path: '/test',
        type: 'File',
        lastModified: '2026-09-21T10:00:00Z',
      } as unknown as NuxeoDocument;
      expect(component.lastContributor(doc)).toBe('—');
    });

    it('should handle empty string values', () => {
      const doc: NuxeoDocument = {
        uid: 'doc1',
        title: 'Test Document',
        path: '/test',
        type: 'File',
        lastModified: '2026-09-21T10:00:00Z',
        properties: {
          'dc:lastContributor': '',
        },
      };
      expect(component.lastContributor(doc)).toBe('');
    });

    it('should convert contributor value to string', () => {
      const doc: NuxeoDocument = {
        uid: 'doc1',
        title: 'Test Document',
        path: '/test',
        type: 'File',
        lastModified: '2026-09-21T10:00:00Z',
        properties: {
          'dc:lastContributor': 123,
        },
      };
      expect(component.lastContributor(doc)).toBe('123');
    });
  });

  describe('onKeydown', () => {
    it('should trigger runSearch when Ctrl+Enter is pressed', () => {
      mockAdminService.nxqlSearch.mockReturnValue(of({ entries: [], totalSize: 0 }));
      const event = new KeyboardEvent('keydown', {
        key: 'Enter',
        ctrlKey: true,
      });
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

      component.onKeydown(event);

      expect(preventDefaultSpy).toHaveBeenCalled();
      expect(mockAdminService.nxqlSearch).toHaveBeenCalled();
    });

    it('should prevent default behavior on Ctrl+Enter', () => {
      const event = new KeyboardEvent('keydown', {
        key: 'Enter',
        ctrlKey: true,
      });
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

      component.onKeydown(event);

      expect(preventDefaultSpy).toHaveBeenCalled();
    });

    it('should not trigger search on Enter without Ctrl modifier', () => {
      const event = new KeyboardEvent('keydown', {
        key: 'Enter',
        ctrlKey: false,
      });
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

      component.onKeydown(event);

      expect(preventDefaultSpy).not.toHaveBeenCalled();
      expect(mockAdminService.nxqlSearch).not.toHaveBeenCalled();
    });

    it('should not trigger search on Ctrl with other keys', () => {
      const event = new KeyboardEvent('keydown', {
        key: 's',
        ctrlKey: true,
      });
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

      component.onKeydown(event);

      expect(preventDefaultSpy).not.toHaveBeenCalled();
      expect(mockAdminService.nxqlSearch).not.toHaveBeenCalled();
    });

    it('should not trigger search on plain key press', () => {
      const event = new KeyboardEvent('keydown', {
        key: 'a',
        ctrlKey: false,
      });

      component.onKeydown(event);

      expect(mockAdminService.nxqlSearch).not.toHaveBeenCalled();
    });
  });

  describe('generateFromNl', () => {
    it('should not generate if aiNlQuery is empty', () => {
      component.aiNlQuery = '';
      component.generateFromNl();
      expect(mockAiGatewayService.nlToNxql).not.toHaveBeenCalled();
    });

    it('should not generate if aiNlQuery is whitespace-only', () => {
      component.aiNlQuery = '   ';
      component.generateFromNl();
      expect(mockAiGatewayService.nlToNxql).not.toHaveBeenCalled();
    });

    // Note: aiGenerating state is transient and completes synchronously with of() observables
    // Tested implicitly by other tests that verify final state

    it('should clear aiGenError before starting generation', () => {
      component.aiNlQuery = 'find all documents';
      component.aiGenError.set('previous error');
      mockAiGatewayService.nlToNxql.mockReturnValue(of({ nxql: 'SELECT * FROM Document' }));
      component.generateFromNl();
      expect(component.aiGenError()).toBeNull();
    });

    it('should call aiGateway.nlToNxql with trimmed query', () => {
      component.aiNlQuery = '  find all documents  ';
      mockAiGatewayService.nlToNxql.mockReturnValue(of({ nxql: 'SELECT * FROM Document' }));
      component.generateFromNl();
      expect(mockAiGatewayService.nlToNxql).toHaveBeenCalledWith('find all documents');
    });

    it('should update queryText with generated NXQL on success', () => {
      component.aiNlQuery = 'find all documents';
      const generatedNxql = 'SELECT * FROM Document WHERE dc:title LIKE "%test%"';
      mockAiGatewayService.nlToNxql.mockReturnValue(of({ nxql: generatedNxql }));
      component.generateFromNl();
      expect(component.queryText).toBe(generatedNxql);
    });

    it('should set aiGenerating to false after successful generation', () => {
      component.aiNlQuery = 'find all documents';
      mockAiGatewayService.nlToNxql.mockReturnValue(of({ nxql: 'SELECT * FROM Document' }));
      component.generateFromNl();
      expect(component.aiGenerating()).toBe(false);
    });

    it('should handle AI generation error', () => {
      component.aiNlQuery = 'find all documents';
      const errorMessage = 'AI service unavailable';
      mockAiGatewayService.nlToNxql.mockReturnValue(throwError(() => ({ message: errorMessage })));
      component.generateFromNl();
      expect(component.aiGenError()).toBeTruthy();
    });

    it('should set aiGenerating to false after generation error', () => {
      component.aiNlQuery = 'find all documents';
      mockAiGatewayService.nlToNxql.mockReturnValue(throwError(() => ({ message: 'Error' })));
      component.generateFromNl();
      expect(component.aiGenerating()).toBe(false);
    });

    it('should use translated fallback message for AI errors', () => {
      component.aiNlQuery = 'find all documents';
      mockAiGatewayService.nlToNxql.mockReturnValue(throwError(() => ({})));
      component.generateFromNl();
      expect(component.aiGenError()).toBe('AI generation failed');
    });

    it('should not modify queryText when generation fails', () => {
      component.queryText = DEFAULT_NXQL;
      component.aiNlQuery = 'find all documents';
      mockAiGatewayService.nlToNxql.mockReturnValue(throwError(() => ({ message: 'Error' })));
      component.generateFromNl();
      expect(component.queryText).toBe(DEFAULT_NXQL);
    });
  });
});
