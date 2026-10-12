import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideRouter, withDisabledInitialNavigation } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { EMPTY, of } from 'rxjs';
import { vi } from 'vitest';

import { AppConfigService } from '@nuxeo-satori/platform/app-config';
import {
  EXTENSION_SLOTS,
  PACKAGED_BROWSE_CONTEXT_MENU,
  provideSatoriExtensions,
} from '@nuxeo-satori/platform/extensions';
import {
  BrowseService,
  DirectoryService,
  DocumentDetailService,
  SelectionService,
  TagService,
  type NuxeoDocument,
} from '@nuxeo-satori/platform/nuxeo-client';

import { BrowseComponent } from './browse';
import { testTranslateModule } from '@agentic-ui/testing/i18n';

// jsdom implements neither; the Satori breadcrumbs and the Material menu both
// observe their host element on construction.
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
  contextParameters: { permissions: ['Read', 'Write', 'ReadWrite', 'AddChildren', 'Everything'] },
};

const mockBrowseService = {
  getByPath: vi.fn(() => of(folder)),
  getBrowseFolderContents: vi.fn(() => of({ folder, entries: [], totalSize: 0 })),
  getFolderContext: vi.fn(() => of(folder)),
  getChildren: vi.fn(() => of({ entries: [], totalSize: 0 })),
  getTrashedChildren: vi.fn(() => EMPTY),
  restoreDocument: vi.fn(() => EMPTY),
  startCsvExport: vi.fn(() => EMPTY),
  pollAndDownloadCsv: vi.fn(() => EMPTY),
  updateDocument: vi.fn(() => of(folder)),
};

const manifest = signal<{ extensionLayers: readonly unknown[] }>({ extensionLayers: [] });

/**
 * The `contextMenu` slot, asserted against the rendered overlay.
 *
 * `browse.spec.ts` shallow-renders on purpose — it stubs the template to
 * `<div></div>` because the full Material surface used to hang the runner — so
 * it cannot see a menu item, which is precisely the thing that was missing.
 * This file renders the real template and opens the menu.
 */
describe('BrowseComponent — rendered contextMenu slot', () => {
  let fixture: ComponentFixture<BrowseComponent>;

  async function render(extensions: unknown): Promise<void> {
    manifest.set({ extensionLayers: [extensions] });
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [BrowseComponent, testTranslateModule()],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([], withDisabledInitialNavigation()),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: BrowseService, useValue: mockBrowseService },
        {
          provide: DocumentDetailService,
          useValue: {
            getFullDocument: vi.fn(() => EMPTY),
            getDocumentPermissions: vi.fn(() => EMPTY),
            fetchThumbnail: vi.fn(() => EMPTY),
            getAuditLog: vi.fn(() => of({ entries: [], totalSize: 0 })),
            subscribe: vi.fn(() => of(undefined)),
            unsubscribe: vi.fn(() => of(undefined)),
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
        {
          provide: MatDialog,
          useValue: { open: vi.fn(() => ({ afterClosed: () => of(false) })) },
        },
        { provide: AppConfigService, useValue: { manifest } },
        provideSatoriExtensions({
          slots: { [EXTENSION_SLOTS.contextMenu]: PACKAGED_BROWSE_CONTEXT_MENU },
        }),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(BrowseComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    // Material renders `mat-menu` content lazily into the CDK overlay, so
    // nothing is on screen until the trigger is used.
    const trigger = fixture.nativeElement.querySelector(
      '[aria-label="More actions"]',
    ) as HTMLElement;
    trigger.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  afterEach(() => fixture?.destroy());

  function menuActionIds(): string[] {
    return [...document.body.querySelectorAll('.cdk-overlay-container [data-action-id]')].map(
      (el) => (el as HTMLElement).getAttribute('data-action-id'),
    ) as string[];
  }

  /**
   * Seen red on purpose by putting the four fixed `<button mat-menu-item>`
   * elements back in place of `@for (action of contextMenuActions())`:
   * `expected [] to include 'acme.contextMenu.escalate'`.
   */
  it('renders a menu item contributed only by the manifest', async () => {
    await render({
      slots: {
        contextMenu: [
          { id: 'acme.contextMenu.escalate', label: 'Escalate', icon: 'flag', order: 5 },
        ],
      },
    });

    expect(menuActionIds()).toContain('acme.contextMenu.escalate');
    const item = document.body.querySelector(
      '[data-action-id="acme.contextMenu.escalate"]',
    ) as HTMLElement;
    expect(item.textContent).toContain('Escalate');
    expect(item.textContent).toContain('flag');
  });

  /**
   * The shipped default, including the rule gate: `unsubscribe` shares its
   * `order` with `subscribe` and is the mutually exclusive half, so it must be
   * absent while the folder is not subscribed.
   */
  it('renders the packaged items when the manifest contributes nothing', async () => {
    await render({});

    expect(menuActionIds()).toEqual([
      'app.contextMenu.share',
      'app.contextMenu.subscribe',
      'app.contextMenu.export',
    ]);
  });

  /** The negative half: fixed markup could not honour either of these. */
  it('hides and relabels packaged items from the manifest', async () => {
    await render({
      overrides: {
        'app.contextMenu.export': { visible: false },
        'app.contextMenu.subscribe': { label: 'Watch this folder' },
      },
    });

    expect(menuActionIds()).not.toContain('app.contextMenu.export');
    const subscribe = document.body.querySelector(
      '[data-action-id="app.contextMenu.subscribe"]',
    ) as HTMLElement;
    expect(subscribe.textContent).toContain('Watch this folder');
  });
});
