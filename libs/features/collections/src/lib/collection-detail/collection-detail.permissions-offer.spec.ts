import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatTabGroup } from '@angular/material/tabs';
import { By } from '@angular/platform-browser';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
  withDisabledInitialNavigation,
} from '@angular/router';
import { of, type Observable } from 'rxjs';
import { vi } from 'vitest';

import { AppConfigService } from '@nuxeo/satori-platform/app-config';
import {
  NXS_PERMISSIONS_PANEL_ID,
  NxsPermissionsPanelComponent,
} from '@nuxeo/satori-platform/components';
import { ExtensionOutletComponent } from '@nuxeo/satori-platform/extensions';
import {
  CollectionService,
  CURRENT_USERNAME,
  DirectoryService,
  DocumentDetailService,
  type NuxeoDocument,
} from '@nuxeo/satori-platform/nuxeo-client';
import { testTranslateModule } from '@agentic-ui/testing/i18n';

import { CollectionDetailComponent } from './collection-detail';

/**
 * Renders the REAL template: what is under test is a binding in it. A Collection's Permissions tab
 * must offer the type's own list, as Web UI does, not the panel's full set.
 */

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

const COLLECTION_FOUR = ['Read', 'ReadCanCollect', 'ReadWrite', 'Everything'];

const collection = {
  uid: 'collection-1',
  title: 'Q3 Contracts',
  type: 'Collection',
  path: '/default-domain/UserWorkspaces/jdoe/Collections/q3',
  state: 'project',
  isCheckedOut: true,
  lastModified: '2026-09-01T10:00:00.000Z',
  properties: {},
  contextParameters: {
    acls: [
      {
        name: 'local',
        aces: [
          {
            id: 'jdoe:Everything:true:::',
            username: 'jdoe',
            permission: 'Everything',
            granted: true,
            status: 'effective',
          },
        ],
      },
    ],
    permissions: ['Everything', 'Read', 'ReadWrite', 'ReadCanCollect', 'Write', 'WriteSecurity'],
    userVisiblePermissions: COLLECTION_FOUR,
  },
} as unknown as NuxeoDocument;

describe('CollectionDetailComponent — Permissions tab offers the type’s list', () => {
  it('passes offer="type" to a registered replacement and to the built-in panel', async () => {
    await TestBed.configureTestingModule({
      imports: [CollectionDetailComponent, testTranslateModule()],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([], withDisabledInitialNavigation()),
        {
          provide: ActivatedRoute,
          useValue: { paramMap: of(convertToParamMap({ uid: 'collection-1' })) },
        },
        { provide: CURRENT_USERNAME, useValue: () => 'jdoe' },
        {
          provide: CollectionService,
          useValue: {
            getById: vi.fn(() => of(collection)),
            getCollectionMembers: vi.fn(() => of({ entries: [], totalSize: 0 })),
          },
        },
        {
          provide: DocumentDetailService,
          useValue: {
            getFullDocument: vi.fn(() => of(collection)),
            getDocumentPermissions: vi.fn((): Observable<NuxeoDocument> => of(collection)),
            fetchThumbnail: vi.fn(() => of(null)),
            searchUsersGroups: vi.fn(() => of([])),
          },
        },
        { provide: DirectoryService, useValue: { getDirectoryEntries: vi.fn(() => of([])) } },
        {
          provide: AppConfigService,
          useValue: { featureToggle: (_id: string, fallback: boolean) => fallback },
        },
        { provide: MatDialog, useValue: { open: vi.fn() } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(CollectionDetailComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.debugElement.query(By.directive(MatTabGroup)).componentInstance.selectedIndex = 1;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const outlet = fixture.debugElement
      .queryAll(By.directive(ExtensionOutletComponent))
      .map((d) => d.componentInstance as ExtensionOutletComponent)
      .find((o) => o.componentId() === NXS_PERMISSIONS_PANEL_ID);
    expect(outlet?.componentInputs()?.['offer']).toBe('type');

    const panel = fixture.debugElement.query(By.directive(NxsPermissionsPanelComponent));
    expect(panel).not.toBeNull();
    const instance = panel.componentInstance as NxsPermissionsPanelComponent;
    expect(instance.offer()).toBe('type');
    expect(
      (instance as unknown as { permissionGroups: () => { permissions: string[] }[] })
        .permissionGroups()
        .flatMap((g) => g.permissions),
    ).toEqual(COLLECTION_FOUR);
  });
});
