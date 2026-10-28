import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideRouter, withDisabledInitialNavigation } from '@angular/router';
import { EMPTY, of } from 'rxjs';
import { vi } from 'vitest';

import { AppConfigService } from '@nuxeo/satori-platform/app-config';
import { provideSatoriExtensions } from '@nuxeo/satori-platform/extensions';
import {
  BrowseService,
  DirectoryService,
  DocumentDetailService,
  SelectionService,
  TagService,
  type NuxeoDocument,
} from '@nuxeo/satori-platform/nuxeo-client';

import { BrowseComponent } from './browse';
import { testTranslateModule } from '@agentic-ui/testing/i18n';

(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= class {
  observe(): void {
    /* no-op */
  }
  unobserve(): void {
    /* no-op */
  }
  disconnect(): void {
    /* no-op */
  }
};

const folder: NuxeoDocument = {
  uid: 'ws-1',
  title: 'Workspace',
  type: 'Workspace',
  path: '/default-domain/workspaces/ws-1',
  state: 'project',
  lastModified: '2026-08-24T10:00:00.000Z',
  properties: {},
  contextParameters: { permissions: ['Read'] },
};

/**
 * The Modified filter's two dates, rendered: they were one Material date range, whose end could not
 * come before its start, and are now two date fields that must keep that rule between them.
 */
describe('BrowseComponent — Modified date range, rendered', () => {
  let fixture: ComponentFixture<BrowseComponent>;

  const field = (index: number) =>
    (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(
      'nxs-date-input.toolbar-filter-date',
    )[index];
  const input = (index: number) => field(index).querySelector('input') as HTMLInputElement;
  const error = (index: number) => field(index).querySelector('mat-error')?.textContent?.trim();

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BrowseComponent, testTranslateModule()],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([], withDisabledInitialNavigation()),
        provideHttpClient(withXhr()),
        provideHttpClientTesting(),
        {
          provide: BrowseService,
          useValue: {
            getByPath: vi.fn(() => of(folder)),
            getBrowseFolderContents: vi.fn(() => of({ folder, entries: [], totalSize: 0 })),
            getFolderContext: vi.fn(() => of(folder)),
            getChildren: vi.fn(() => of({ entries: [], totalSize: 0 })),
            getTrashedChildren: vi.fn(() => EMPTY),
          },
        },
        {
          provide: DocumentDetailService,
          useValue: {
            getFullDocument: vi.fn(() => EMPTY),
            getDocumentPermissions: vi.fn(() => EMPTY),
            fetchThumbnail: vi.fn(() => EMPTY),
            getAuditLog: vi.fn(() => of({ entries: [], totalSize: 0 })),
          },
        },
        {
          provide: DirectoryService,
          useValue: {
            getEventTypes: vi.fn(() => of([])),
            getEventCategories: vi.fn(() => of([])),
            getEntries: vi.fn(() => of([])),
            getAllL10nEntries: vi.fn(() => of([])),
          },
        },
        { provide: TagService, useValue: { searchTags: vi.fn(() => of([])) } },
        {
          provide: SelectionService,
          useValue: {
            selectedIds: signal(new Set<string>()),
            selectedCount: signal(0),
            isSelected: vi.fn(() => false),
            isAllSelected: vi.fn(() => false),
            isIndeterminate: vi.fn(() => false),
            toggle: vi.fn(),
            selectAll: vi.fn(),
            clear: vi.fn(),
            forgetPreviews: vi.fn(),
          },
        },
        { provide: MatDialog, useValue: { open: vi.fn() } },
        { provide: AppConfigService, useValue: { manifest: signal({ extensionLayers: [] }) } },
        provideSatoriExtensions({}),
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(BrowseComponent);
    await render();
  });

  it('refuses an end before the start in either field, and says which day bounds it', async () => {
    fixture.componentInstance.filterModifiedFrom.set(new Date(2026, 9, 20));
    await render();
    input(1).value = '10/10/2026';
    input(1).dispatchEvent(new Event('input'));
    input(1).dispatchEvent(new Event('blur'));
    await render();
    expect(error(1)).toBe('Enter 10/20/2026 or later');
    expect(input(1).getAttribute('aria-invalid')).toBe('true');

    fixture.componentInstance.filterModifiedFrom.set(null);
    fixture.componentInstance.filterModifiedTo.set(new Date(2026, 9, 10));
    await render();
    input(0).value = '10/20/2026';
    input(0).dispatchEvent(new Event('input'));
    input(0).dispatchEvent(new Event('blur'));
    await render();
    expect(error(0)).toBe('Enter 10/10/2026 or earlier');
  });

  it('accepts an end on or after the start', async () => {
    fixture.componentInstance.filterModifiedFrom.set(new Date(2026, 9, 10));
    await render();
    input(1).value = '10/10/2026';
    input(1).dispatchEvent(new Event('input'));
    input(1).dispatchEvent(new Event('blur'));
    await render();
    expect(error(1)).toBeUndefined();
    expect(fixture.componentInstance.filterModifiedTo()).toEqual(new Date(2026, 9, 10));
  });
});
