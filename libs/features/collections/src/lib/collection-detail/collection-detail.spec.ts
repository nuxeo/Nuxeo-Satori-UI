import { ComponentFixture, TestBed } from '@angular/core/testing';
import { testTranslateModule } from '@agentic-ui/testing/i18n';
import { HttpErrorResponse } from '@angular/common/http';
import { provideZonelessChangeDetection } from '@angular/core';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
  Router,
  withDisabledInitialNavigation,
} from '@angular/router';
import { Subject, of, throwError, type Observable } from 'rxjs';
import { vi } from 'vitest';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';

import { PageEvent } from '@angular/material/paginator';
import { Sort } from '@angular/material/sort';

import {
  type AuditEntry,
  CollectionService,
  CURRENT_USERNAME,
  DocumentDetailService,
  DirectoryService,
  type NuxeoAce,
  NuxeoDocument,
} from '@nuxeo-satori/platform/nuxeo-client';

import { CollectionDetailComponent } from './collection-detail';

const TEST_USERNAME = 'jdoe';

/**
 * Mocks declared with their FULL surface up front, and with explicit return types.
 *
 * Two reasons, both learned from `typecheck` after `nx test` was green:
 *
 * 1. `vi.fn(() => of(null))` infers `Observable<null>`, so a later
 *    `mockReturnValue(of(someDocument))` does not typecheck.
 * 2. TypeScript fixes an object literal's shape at declaration, so adding
 *    `mockDetailService.fetchPdfRendition = vi.fn(...)` inside a test is an error on a
 *    property that does not exist.
 *
 * Vitest strips types through esbuild, so neither shows up in a test run. Declaring the
 * whole surface here also makes the mock a readable statement of what this component
 * actually depends on.
 */
const obs =
  <T>(v: T) =>
  (): Observable<T> =>
    of(v);

const mockCollectionService = {
  getById: vi.fn((): Observable<NuxeoDocument | null> => of(null)),
  getCollectionMembers: vi.fn((): Observable<{ entries: NuxeoDocument[]; totalSize: number }> =>
    of({ entries: [], totalSize: 0 }),
  ),
  bulkDownload: vi.fn(obs(new Blob())),
};

const mockDetailService = {
  getFullDocument: vi.fn((): Observable<NuxeoDocument | null> => of(null)),
  fetchThumbnail: vi.fn((): Observable<Blob | null> => of(null)),
  fetchPdfRendition: vi.fn(obs(new Blob())),
  exportXml: vi.fn(obs(new Blob())),
  lockDocument: vi.fn((): Observable<NuxeoDocument | undefined> => of(undefined)),
  unlockDocument: vi.fn((): Observable<NuxeoDocument | undefined> => of(undefined)),
  subscribe: vi.fn(obs(undefined)),
  unsubscribe: vi.fn(obs(undefined)),
  trashDocument: vi.fn(obs(undefined)),
  sendNotificationEmailForPermission: vi.fn(obs(undefined)),
  blockPermissionInheritance: vi.fn(obs(undefined)),
  unblockPermissionInheritance: vi.fn(obs(undefined)),
  getAuditLog: vi.fn((): Observable<Record<string, unknown>> => of({ entries: [], totalSize: 0 })),
};

const mockDirectoryService = {
  getEventTypes: vi.fn((): Observable<{ id: string; displayLabel: string }[]> => of([])),
  getEventCategories: vi.fn((): Observable<{ id: string; displayLabel: string }[]> => of([])),
};

// `open` is deliberately typed loosely: several tests replace it with a two-argument
// implementation to capture the `data` a dialog was configured with.
const mockDialog = {
  open: vi.fn((..._args: unknown[]): { afterClosed: () => Observable<unknown> } => ({
    afterClosed: () => of(undefined),
  })),
};

const mockSnackBar = {
  open: vi.fn(),
};

const mockCollection: NuxeoDocument = {
  uid: 'collection-1',
  path: '/default-domain/workspaces/collections/test',
  type: 'Collection',
  state: 'project',
  title: 'Test Collection',
  lastModified: '2026-08-24T15:30:00.000Z',
  properties: {
    'dc:title': 'Test Collection',
    'dc:description': 'A test collection',
    'dc:creator': 'admin',
    'dc:created': '2026-08-20T10:00:00.000Z',
    'dc:modified': '2026-08-24T15:30:00.000Z',
    'dc:lastContributor': 'admin',
  },
  facets: [],
  contextParameters: {
    // The `permissions` enricher, not decoration: `canViewDocumentAuditLog()` reads it, so
    // without `Read` here every history assertion silently takes the "cannot audit" branch
    // and passes for the wrong reason.
    permissions: ['Read', 'Write', 'ReadWrite', 'Everything', 'WriteSecurity', 'Remove'],
    acls: [
      {
        name: 'local',
        aces: [
          {
            id: 'ace-admin',
            username: 'admin',
            permission: 'Everything',
            granted: true,
            creator: 'system',
            begin: null,
            end: null,
            status: 'effective',
            externalUser: false,
          },
        ],
      },
      {
        name: 'inherited',
        aces: [
          {
            id: 'ace-members',
            username: 'members',
            permission: 'Read',
            granted: true,
            creator: 'system',
            begin: null,
            end: null,
            status: 'effective',
            externalUser: false,
          },
        ],
      },
    ],
  },
};

/**
 * Build a document variant without casting.
 *
 * The alternative — `{ ...mockCollection, contextParameters: {...} } as any` — makes every
 * fixture immune to the very shape changes these tests exist to catch: if `NuxeoAce` gains a
 * required field, a cast fixture keeps compiling and the suite keeps passing while the
 * component is fed a shape the server never sends.
 */
function docWith(overrides: Partial<NuxeoDocument>): NuxeoDocument {
  return { ...mockCollection, ...overrides };
}

function aceWith(overrides: Partial<NuxeoAce> = {}): NuxeoAce {
  return {
    id: 'ace-1',
    username: 'jdoe',
    permission: 'ReadWrite',
    granted: true,
    creator: 'admin',
    begin: null,
    end: null,
    status: 'effective',
    externalUser: false,
    ...overrides,
  };
}

describe('CollectionDetailComponent', () => {
  let component: CollectionDetailComponent;
  let fixture: ComponentFixture<CollectionDetailComponent>;
  let router: Router;

  /**
   * jsdom implements neither `URL.createObjectURL` nor `revokeObjectURL`, so the thumbnail path
   * threw `TypeError: URL.createObjectURL is not a function` as an *unhandled* error — which
   * Vitest reports with "this might cause false positive tests", and it was right: the tests
   * still passed while the code under them was blowing up.
   *
   * Stubbed with counters rather than bare no-ops, because create/revoke has to be checked as a
   * *pair*. This component keeps `thumbnailBlobUrls` and revokes on destroy precisely because an
   * earlier version dropped the previous batch's `SafeUrl`s without revoking the blobs behind
   * them, pinning a batch in memory per navigation.
   */
  const created: string[] = [];
  const revoked: string[] = [];
  let blobSeq = 0;

  // Installed once for the whole file, not per test with a restore in `afterEach`. Restoring
  // them put `undefined` back before TestBed's automatic fixture cleanup ran, so
  // `revokeThumbnails()` on destroy threw and the run failed with "1 component threw errors
  // during cleanup". jsdom never provided these at all, so a working stub is strictly better
  // than the absence it would be restored to.
  (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => {
    const url = `blob:mock/${(blobSeq += 1)}`;
    created.push(url);
    return url;
  });
  (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn((u: string) => {
    revoked.push(u);
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    created.length = 0;
    revoked.length = 0;

    mockCollectionService.getById.mockReturnValue(of(mockCollection));
    mockDetailService.getFullDocument.mockReturnValue(of(mockCollection));
    mockCollectionService.getCollectionMembers.mockReturnValue(of({ entries: [], totalSize: 0 }));
    // Reset explicitly: `vi.clearAllMocks()` clears call history but NOT an implementation
    // installed with `mockReturnValue`, so a Blob stubbed in one test leaked into every later
    // one and drove the unhandled error above.
    mockDetailService.fetchThumbnail.mockReturnValue(of(null));

    await TestBed.configureTestingModule({
      imports: [testTranslateModule(), testTranslateModule(), CollectionDetailComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([], withDisabledInitialNavigation()),
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap({ uid: 'collection-1' })),
          },
        },
        // The token defaults to `() => null`, so without this the lock-owner assertions
        // below would pass against null whether the component read the acting user or not.
        { provide: CURRENT_USERNAME, useValue: () => TEST_USERNAME },
        { provide: CollectionService, useValue: mockCollectionService },
        { provide: DocumentDetailService, useValue: mockDetailService },
        { provide: DirectoryService, useValue: mockDirectoryService },
        { provide: MatDialog, useValue: mockDialog },
        { provide: MatSnackBar, useValue: mockSnackBar },
      ],
    })
      .overrideComponent(CollectionDetailComponent, {
        set: { imports: [], template: '<div></div>' },
      })
      .compileComponents();

    fixture = TestBed.createComponent(CollectionDetailComponent);
    component = fixture.componentInstance;
    router = TestBed.inject(Router);
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load collection on init', () => {
    expect(mockDetailService.getFullDocument).toHaveBeenCalledWith('collection-1');
  });

  it('should fallback to collectionService if detailService fails', () => {
    mockDetailService.getFullDocument.mockReturnValue(throwError(() => new Error('Not found')));
    mockCollectionService.getById.mockReturnValue(of(mockCollection));

    component['loadCollection']();

    expect(mockCollectionService.getById).toHaveBeenCalledWith('collection-1');
  });

  describe('computed signals', () => {
    it('should compute breadcrumbItems from collection path', () => {
      component.collection.set(mockCollection);
      const items = component.breadcrumbItems();
      expect(items.length).toBeGreaterThan(0);
      // `SatBreadcrumbsItem` is a union and only one member carries `href`, so narrow rather
      // than reaching through it.
      const first = items[0] as { href?: string };
      expect(first.href).toContain('/browse');
    });

    it('should return empty array when collection has no path', () => {
      component.collection.set(docWith({ path: undefined }));
      expect(component.breadcrumbItems()).toEqual([]);
    });

    it('should use cached breadcrumbs for same collection path', () => {
      component.collection.set(mockCollection);
      const firstCall = component.breadcrumbItems();
      // Second call with same path should return cached result
      const secondCall = component.breadcrumbItems();
      expect(firstCall).toBe(secondCall); // Same reference = cache hit
    });

    it('should compute localAces', () => {
      component.collection.set(mockCollection);
      const aces = component.localAces();
      expect(aces.length).toBeGreaterThan(0);
      expect(aces[0]?.username).toBe('admin');
    });

    it('should compute inheritedAces', () => {
      component.collection.set(mockCollection);
      const aces = component.inheritedAces();
      expect(aces.length).toBeGreaterThan(0);
      expect(aces[0]?.username).toBe('members');
    });

    it('should compute externalAces', () => {
      const colWithExternal = docWith({
        contextParameters: {
          acls: [
            {
              name: 'local',
              aces: [
                {
                  id: 'ace-external',
                  username: 'external@example.com',
                  permission: 'Read',
                  granted: true,
                  creator: 'admin',
                  begin: null,
                  end: null,
                  status: 'effective',
                  externalUser: true,
                },
              ],
            },
          ],
        },
      });
      component.collection.set(colWithExternal);
      const aces = component.externalAces();
      expect(aces.length).toBeGreaterThan(0);
      expect(aces[0]?.externalUser).toBe(true);
    });

    it('should detect blocked inheritance', () => {
      const colWithoutInherited = docWith({
        contextParameters: { acls: [{ name: 'local', aces: [] }] },
      });
      component.collection.set(colWithoutInherited);
      expect(component.isInheritanceBlocked()).toBe(true);
    });

    it('should detect unblocked inheritance', () => {
      component.collection.set(mockCollection);
      expect(component.isInheritanceBlocked()).toBe(false);
    });

    it('should check if collection is in clipboard', () => {
      component['collectionUid'] = 'collection-1';
      component.clipboardDocs.set([{ uid: 'collection-1', title: 'Test' }]);
      expect(component.isInClipboard()).toBe(true);
    });
  });

  describe('onBreadcrumbClick', () => {
    it('should navigate when anchor clicked', () => {
      const navigateSpy = vi.spyOn(router, 'navigateByUrl');
      const mockEvent = {
        target: { closest: () => ({ getAttribute: () => '/browse/test' }) },
        preventDefault: vi.fn(),
      } as any;

      component.onBreadcrumbClick(mockEvent);

      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect(navigateSpy).toHaveBeenCalledWith('/browse/test');
    });

    it('should do nothing if no href', () => {
      const navigateSpy = vi.spyOn(router, 'navigateByUrl');
      const mockEvent = {
        target: { closest: () => null },
        preventDefault: vi.fn(),
      } as any;

      component.onBreadcrumbClick(mockEvent);

      expect(navigateSpy).not.toHaveBeenCalled();
    });
  });

  describe('goToCollections', () => {
    it('should navigate to collections list', () => {
      const navigateSpy = vi.spyOn(router, 'navigateByUrl');

      component.goToCollections();

      expect(navigateSpy).toHaveBeenCalledWith('/collections');
    });
  });

  describe('docIcon', () => {
    it('should return icon for document type', () => {
      const doc = docWith({ type: 'File' });
      const icon = component.docIcon(doc);
      expect(icon).toBeTruthy();
      expect(typeof icon).toBe('string');
    });
  });

  describe('lastContributor', () => {
    it('should return last contributor from properties', () => {
      const doc = docWith({ properties: { 'dc:lastContributor': 'john' } });
      expect(component.lastContributor(doc)).toBe('john');
    });

    it('should return empty string when missing', () => {
      const doc = docWith({ properties: {} });
      expect(component.lastContributor(doc)).toBe('');
    });
  });

  describe('contributorInitial', () => {
    it('should return first character of last contributor', () => {
      const doc = docWith({ properties: { 'dc:lastContributor': 'admin' } });
      expect(component.contributorInitial(doc)).toBe('A');
    });
  });

  describe('onRowClick', () => {
    it('should navigate to document detail', () => {
      const navigateSpy = vi.spyOn(router, 'navigateByUrl');
      const doc = docWith({ uid: 'doc-123', type: 'File' });

      component.onRowClick(doc);

      expect(navigateSpy).toHaveBeenCalledWith('/doc/doc-123');
    });
  });

  describe('editCollection', () => {
    it('should open edit dialog', () => {
      component.collection.set(mockCollection);
      mockDialog.open.mockReturnValue({ afterClosed: () => of({ title: 'Updated' }) });

      component.editCollection();

      expect(mockDialog.open).toHaveBeenCalled();
    });

    it('should do nothing when no collection', () => {
      component.collection.set(null);
      component.editCollection();
      expect(mockDialog.open).not.toHaveBeenCalled();
    });
  });

  describe('toggleLock', () => {
    it('should lock document when not locked', () => {
      component.collection.set(mockCollection);
      component.isLocked.set(false);
      mockDetailService.lockDocument.mockReturnValue(of(undefined));

      component.toggleLock();

      expect(mockDetailService.lockDocument).toHaveBeenCalledWith('collection-1');
    });

    it('should unlock document when locked', () => {
      component.collection.set(mockCollection);
      component.isLocked.set(true);
      mockDetailService.unlockDocument.mockReturnValue(of(undefined));

      component.toggleLock();

      expect(mockDetailService.unlockDocument).toHaveBeenCalledWith('collection-1');
    });

    it('should do nothing when action in progress', () => {
      component.actionInProgress.set('locking');
      component.toggleLock();
      expect(mockDetailService.lockDocument).not.toHaveBeenCalled();
    });

    it('records the acting user as the lock owner, not a fixed account', () => {
      component.collection.set(mockCollection);
      component.isLocked.set(false);
      mockDetailService.lockDocument.mockReturnValue(of(undefined));

      component.toggleLock();

      expect(component.lockOwner()).toBe(TEST_USERNAME);
    });

    it('clears the lock owner on unlock', () => {
      component.collection.set(mockCollection);
      component.isLocked.set(true);
      mockDetailService.unlockDocument.mockReturnValue(of(undefined));

      component.toggleLock();

      expect(component.lockOwner()).toBeNull();
    });
  });

  describe('lock owner and who may unlock', () => {
    const LOCKED_AT = '2026-08-24T10:00:00.000Z';
    /** What Nuxeo's lock policy leaves a non-owner with ReadWrite: Write is gone, Read is not. */
    const readOnly = { permissions: ['Read', 'ReadWrite', 'Browse'] };

    function load(collection: NuxeoDocument): void {
      mockDetailService.getFullDocument.mockReturnValue(of(collection));
      component['loadCollection']();
    }

    it('opens a collection locked earlier as locked, with its owner and date', () => {
      load(docWith({ lockOwner: 'alice', lockCreated: LOCKED_AT }));

      expect(component.isLocked()).toBe(true);
      expect(component.lockOwner()).toBe('alice');
      expect(component.lockTooltip()).toBe('Locked by alice on August 24, 2026');
    });

    it('keeps the lock state when the full read fails and the fallback answers', () => {
      component.isLocked.set(false);
      mockDetailService.getFullDocument.mockReturnValue(throwError(() => new Error('enricher')));
      mockCollectionService.getById.mockReturnValue(
        of(docWith({ lockOwner: 'alice', lockCreated: LOCKED_AT })),
      );

      component['loadCollection']();

      expect(component.isLocked()).toBe(true);
      expect(component.lockTooltip()).toBe('Locked by alice on August 24, 2026');
    });

    it.each([
      [
        'succeeds',
        (pending: Subject<NuxeoDocument>) =>
          pending.next(docWith({ lockOwner: TEST_USERNAME, lockCreated: LOCKED_AT })),
      ],
      [
        'is refused',
        (pending: Subject<NuxeoDocument>) => pending.error(new HttpErrorResponse({ status: 409 })),
      ],
    ])('ignores a Lock that %s after navigating to another collection', (_how, settle) => {
      load(docWith({ lockOwner: null, lockCreated: null }));
      const pending = new Subject<NuxeoDocument>();
      mockDetailService.lockDocument.mockReturnValue(pending);

      component.toggleLock();
      component['collectionUid'] = 'collection-2';
      mockSnackBar.open.mockClear();
      settle(pending);

      expect(mockDetailService.lockDocument).toHaveBeenCalledWith('collection-1');
      expect(component.isLocked()).toBe(false);
      expect(component.lockOwner()).toBeNull();
      expect(component.actionInProgress()).toBeNull();
      expect(mockSnackBar.open).not.toHaveBeenCalled();
    });

    it('offers no lock action while the next collection is still loading', () => {
      load(docWith({}));
      mockDetailService.getFullDocument.mockReturnValue(new Subject<NuxeoDocument | null>());
      component['collectionUid'] = 'collection-2';

      component['loadCollection']();
      component.toggleLock();

      expect(component.showsLockAction()).toBe(false);
      expect(mockDetailService.lockDocument).not.toHaveBeenCalled();
    });

    it('lets a lock request from the previous collection neither hold nor clear the busy flag', () => {
      load(docWith({ lockOwner: null, lockCreated: null }));
      const first = new Subject<NuxeoDocument>();
      mockDetailService.lockDocument.mockReturnValueOnce(first);
      component.toggleLock();

      // What the route subscription does before it switches `collectionUid`.
      component['releaseLockRequest']();
      component['collectionUid'] = 'collection-2';
      expect(component.actionInProgress()).toBeNull();

      load(docWith({ uid: 'collection-2', lockOwner: null, lockCreated: null }));
      mockDetailService.lockDocument.mockReturnValueOnce(new Subject<NuxeoDocument>());
      component.toggleLock();
      first.next(docWith({ lockOwner: TEST_USERNAME, lockCreated: LOCKED_AT }));

      expect(mockDetailService.lockDocument).toHaveBeenLastCalledWith('collection-2');
      expect(component.actionInProgress()).toBe('lock');
      expect(component.isLocked()).toBe(false);
    });

    it('ignores a read that lands after navigating to another collection', () => {
      const late = new Subject<NuxeoDocument | null>();
      mockDetailService.getFullDocument.mockReturnValue(late);
      component['loadCollection']();
      component['collectionUid'] = 'collection-2';
      load(docWith({ uid: 'collection-2', lockOwner: null, lockCreated: null }));

      late.next(docWith({ lockOwner: 'alice', lockCreated: LOCKED_AT }));

      expect(component.collection()?.uid).toBe('collection-2');
      expect(component.isLocked()).toBe(false);
    });

    it('ignores a fallback that lands after navigating to another collection', () => {
      const late = new Subject<NuxeoDocument | null>();
      mockDetailService.getFullDocument.mockReturnValue(throwError(() => new Error('enricher')));
      mockCollectionService.getById.mockReturnValue(late);
      component['loadCollection']();
      component['collectionUid'] = 'collection-2';
      load(docWith({ uid: 'collection-2', lockOwner: null, lockCreated: null }));

      late.next(docWith({ lockOwner: 'alice', lockCreated: LOCKED_AT }));

      expect(component.collection()?.uid).toBe('collection-2');
      expect(component.isLocked()).toBe(false);
    });

    it('keeps a reader read-only when the fallback answers for a locked collection', () => {
      mockDetailService.getFullDocument.mockReturnValue(throwError(() => new Error('enricher')));
      mockCollectionService.getById.mockReturnValue(
        of(docWith({ lockOwner: 'alice', lockCreated: LOCKED_AT, contextParameters: readOnly })),
      );

      component['loadCollection']();

      expect(component.showsLockAction()).toBe(true);
      expect(component.canEditCollection()).toBe(false);
    });

    it('does not carry a previous lock into a fallback read of an unlocked collection', () => {
      load(docWith({ lockOwner: 'alice', lockCreated: LOCKED_AT }));
      mockDetailService.getFullDocument.mockReturnValue(throwError(() => new Error('enricher')));
      mockCollectionService.getById.mockReturnValue(
        of(docWith({ lockOwner: null, lockCreated: null })),
      );

      component['loadCollection']();

      expect(component.isLocked()).toBe(false);
      expect(component.lockOwner()).toBeNull();
    });

    it('has no lock tooltip while unlocked', () => {
      load(docWith({ lockOwner: null, lockCreated: null }));

      expect(component.isLocked()).toBe(false);
      expect(component.lockTooltip()).toBeNull();
    });

    it('shows a locked collection to a user the lock policy left read-only, without letting them unlock', () => {
      load(docWith({ lockOwner: 'alice', lockCreated: LOCKED_AT, contextParameters: readOnly }));

      expect(component.showsLockAction()).toBe(true);
      expect(component.canEditCollection()).toBe(false);

      component.toggleLock();

      expect(mockDetailService.unlockDocument).not.toHaveBeenCalled();
      expect(mockSnackBar.open).toHaveBeenCalledWith(
        "You can't unlock this document because it is locked by another user.",
        'OK',
        expect.anything(),
      );
    });

    it('offers no lock action on a version, which carries the Immutable facet', () => {
      load(docWith({ lockOwner: 'alice', lockCreated: LOCKED_AT, facets: ['Immutable'] }));

      expect(component.showsLockAction()).toBe(false);
    });

    it('offers no lock action on the repository root', () => {
      load(docWith({ type: 'Root' }));

      expect(component.showsLockAction()).toBe(false);
    });

    it('does not offer Lock to a read-only user on an unlocked collection', () => {
      load(docWith({ contextParameters: readOnly }));

      expect(component.showsLockAction()).toBe(false);
    });

    it('records the owner and date the server returns from Lock', () => {
      load(docWith({}));
      mockDetailService.lockDocument.mockReturnValue(
        of(docWith({ lockOwner: TEST_USERNAME, lockCreated: '2026-09-01T08:00:00.000Z' })),
      );

      component.toggleLock();

      expect(component.lockTooltip()).toBe(`Locked by ${TEST_USERNAME} on September 1, 2026`);
    });

    it.each([
      [false, 409, 'Document already locked by another user, please refresh your page.'],
      [false, 403, "You don't have permission to lock this document."],
      [true, 409, "You can't unlock this document because it is locked by another user."],
      [true, 403, "You don't have permission to unlock this document."],
      [true, 500, 'Action failed'],
    ])('locked=%s: explains a %i refusal specifically', (locked, status, message) => {
      load(docWith(locked ? { lockOwner: TEST_USERNAME, lockCreated: LOCKED_AT } : {}));
      const refusal = throwError(() => new HttpErrorResponse({ status }));
      mockDetailService.lockDocument.mockReturnValue(refusal);
      mockDetailService.unlockDocument.mockReturnValue(refusal);

      component.toggleLock();

      expect(mockSnackBar.open).toHaveBeenCalledWith(message, 'OK', expect.anything());
      expect(component.isLocked()).toBe(locked);
      expect(component.actionInProgress()).toBeNull();
    });
  });

  describe('toggleSubscription', () => {
    it('should subscribe when not subscribed', () => {
      component.collection.set(mockCollection);
      component['collectionUid'] = 'collection-1';
      component.isSubscribed.set(false);
      mockDetailService.subscribe.mockReturnValue(of(undefined));

      component.toggleSubscription();

      expect(mockDetailService.subscribe).toHaveBeenCalledWith('collection-1');
    });

    it('should unsubscribe when subscribed', () => {
      component.collection.set(mockCollection);
      component['collectionUid'] = 'collection-1';
      component.isSubscribed.set(true);
      mockDetailService.unsubscribe.mockReturnValue(of(undefined));

      component.toggleSubscription();

      expect(mockDetailService.unsubscribe).toHaveBeenCalledWith('collection-1');
    });

    it('should do nothing when action in progress', () => {
      component.actionInProgress.set('subscribing');
      component.toggleSubscription();
      expect(mockDetailService.subscribe).not.toHaveBeenCalled();
    });
  });

  describe('deleteCollection', () => {
    it('should delete after confirmation', async () => {
      component.collection.set(mockCollection);
      component['collectionUid'] = 'collection-1';
      component.actionInProgress.set(null);
      mockDialog.open.mockReturnValue({ afterClosed: () => of(true) });
      mockDetailService.trashDocument.mockReturnValue(of(undefined));
      const navigateSpy = vi.spyOn(router, 'navigateByUrl');

      component.deleteCollection();

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockDialog.open).toHaveBeenCalled();
      expect(mockDetailService.trashDocument).toHaveBeenCalledWith('collection-1');
      // NXSAT-204: after trashing, land in the collection's parent folder rather than
      // back on `/collections`, which for a personal collection would 404 the user.
      expect(navigateSpy).toHaveBeenCalledWith('/browse/default-domain/workspaces/collections');
    });

    it('should not delete when cancelled', () => {
      component.collection.set(mockCollection);
      mockDialog.open.mockReturnValue({ afterClosed: () => of(false) });

      component.deleteCollection();

      expect(mockDetailService.trashDocument).not.toHaveBeenCalled();
    });

    it('should do nothing when action in progress', () => {
      component.actionInProgress.set('deleting');
      component.deleteCollection();
      expect(mockDialog.open).not.toHaveBeenCalled();
    });
  });

  describe('toggleClipboard', () => {
    it('should add to clipboard when not present', () => {
      component.collection.set(mockCollection);
      component['collectionUid'] = 'collection-1';
      component.clipboardDocs.set([]);

      component.toggleClipboard();

      expect(component.clipboardDocs().length).toBe(1);
      expect(component.clipboardDocs()[0]?.uid).toBe('collection-1');
    });

    it('should remove from clipboard when present', () => {
      component.collection.set(mockCollection);
      component['collectionUid'] = 'collection-1';
      component.clipboardDocs.set([{ uid: 'collection-1', title: 'Test' }]);

      component.toggleClipboard();

      expect(component.clipboardDocs().length).toBe(0);
    });

    it('should do nothing when no collection', () => {
      component.collection.set(null);
      const initialDocs = component.clipboardDocs();
      component.toggleClipboard();
      expect(component.clipboardDocs()).toEqual(initialDocs);
    });
  });

  describe('exportCollection', () => {
    it('should open export dialog', () => {
      component.collection.set(mockCollection);
      mockDialog.open.mockReturnValue({ afterClosed: () => of(undefined) });

      component.exportCollection();

      expect(mockDialog.open).toHaveBeenCalled();
    });

    /**
     * The `exportFn` passed into the dialog is a closure the dialog calls later, so opening the
     * dialog does not execute any of its four branches. Pulling it out of the dialog config and
     * invoking it directly is the only way to cover them — and the only way to notice that a
     * type routes to the wrong service call, which a "dialog opened" assertion cannot see.
     */
    it('should route each export type to the right service call', () => {
      component.collection.set(mockCollection);
      component['collectionUid'] = 'collection-1';

      // Typed to the dialog's data contract so a change to `ExportType` breaks this test
      // rather than silently skipping a branch.
      type ExportCapture = {
        documentUid: string;
        documentTitle: string;
        exportFn: (type: 'thumbnail' | 'pdf' | 'zip' | 'xml', uid: string) => Observable<Blob>;
      };
      let captured: ExportCapture | undefined;
      mockDialog.open.mockImplementation((...args: unknown[]) => {
        captured = (args[1] as { data?: ExportCapture })?.data;
        return { afterClosed: () => of(undefined) };
      });

      component.exportCollection();
      if (!captured) throw new Error('the dialog was given no data');
      const { exportFn } = captured;

      mockDetailService.fetchThumbnail.mockReturnValue(of(new Blob()));
      mockDetailService.fetchPdfRendition.mockReturnValue(of(new Blob()));
      mockCollectionService.bulkDownload.mockReturnValue(of(new Blob()));
      mockDetailService.exportXml.mockReturnValue(of(new Blob()));

      exportFn('thumbnail', 'collection-1');
      expect(mockDetailService.fetchThumbnail).toHaveBeenCalledWith('collection-1');

      exportFn('pdf', 'collection-1');
      expect(mockDetailService.fetchPdfRendition).toHaveBeenCalledWith('collection-1');

      exportFn('zip', 'collection-1');
      expect(mockCollectionService.bulkDownload).toHaveBeenCalledWith(
        'collection-1',
        'Test Collection.zip',
      );

      exportFn('xml', 'collection-1');
      expect(mockDetailService.exportXml).toHaveBeenCalledWith('collection-1');

      mockDialog.open.mockImplementation(() => ({ afterClosed: () => of(undefined) }));
    });
  });

  describe('permission management', () => {
    const ace = aceWith();

    beforeEach(() => {
      component['collectionUid'] = 'collection-1';
      component.collection.set(mockCollection);
    });

    it('should open the edit dialog and reload when a permission changed', async () => {
      mockDialog.open.mockReturnValue({ afterClosed: () => of(true) });
      component.editPermission(ace);
      await new Promise((r) => setTimeout(r, 10));
      expect(mockDetailService.getFullDocument).toHaveBeenCalled();
      expect(mockSnackBar.open).toHaveBeenCalled();
    });

    it('should not reload when the edit dialog was dismissed', () => {
      mockDialog.open.mockReturnValue({ afterClosed: () => of(undefined) });
      mockDetailService.getFullDocument.mockClear();
      component.editPermission(ace);
      expect(mockDetailService.getFullDocument).not.toHaveBeenCalled();
    });

    it('should open the delete dialog with the resolved labels', () => {
      let captured: { permissionLabel?: string; timeFrameLabel?: string } | undefined;
      mockDialog.open.mockImplementation((...args: unknown[]) => {
        captured = (args[1] as { data?: typeof captured })?.data;
        return { afterClosed: () => of(false) };
      });

      component.deletePermission(ace);

      // Asserted because these are computed, not passed through: a wrong label here is a
      // confirmation dialog describing a different permission from the one being removed.
      expect(captured?.permissionLabel).toBe('Edit');
      expect(captured?.timeFrameLabel).toBe('Permanent');
      mockDialog.open.mockImplementation(() => ({ afterClosed: () => of(undefined) }));
    });

    it('should reload after a permission is deleted', async () => {
      mockDialog.open.mockReturnValue({ afterClosed: () => of(true) });
      component.deletePermission(ace);
      await new Promise((r) => setTimeout(r, 10));
      expect(mockDetailService.getFullDocument).toHaveBeenCalled();
    });

    it('should open the external edit dialog flagged as external', () => {
      let captured: { isExternal?: boolean } | undefined;
      mockDialog.open.mockImplementation((...args: unknown[]) => {
        captured = (args[1] as { data?: typeof captured })?.data;
        return { afterClosed: () => of(false) };
      });

      component.editExternalPermission(ace);

      expect(captured?.isExternal).toBe(true);
      mockDialog.open.mockImplementation(() => ({ afterClosed: () => of(undefined) }));
    });

    it('should share with an external user and reload', async () => {
      mockDialog.open.mockReturnValue({ afterClosed: () => of(true) });
      component.shareWithExternal();
      await new Promise((r) => setTimeout(r, 10));
      expect(mockDetailService.getFullDocument).toHaveBeenCalled();
    });

    it('should strip the transient/ prefix from a username', () => {
      expect(component.displayUsername(aceWith({ username: 'transient/guest' }))).toBe('guest');
      expect(component.displayUsername(ace)).toBe('jdoe');
    });

    describe('sendNotificationEmail', () => {
      it('should send and clear the in-progress flag', () => {
        mockDetailService.sendNotificationEmailForPermission.mockReturnValue(of(undefined));
        component.actionInProgress.set(null);

        component.sendNotificationEmail(ace);

        expect(mockDetailService.sendNotificationEmailForPermission).toHaveBeenCalledWith(
          'collection-1',
          'ace-1',
        );
        expect(component.actionInProgress()).toBeNull();
      });

      it('should clear the in-progress flag on failure', () => {
        mockDetailService.sendNotificationEmailForPermission = vi.fn(() =>
          throwError(() => new Error('smtp down')),
        );
        component.actionInProgress.set(null);

        component.sendNotificationEmail(ace);

        // The flag must be released on the error path too, or every later action is blocked
        // by the guard for the rest of the component's life.
        expect(component.actionInProgress()).toBeNull();
      });

      it('should do nothing when another action is in progress', () => {
        mockDetailService.sendNotificationEmailForPermission.mockClear();
        component.actionInProgress.set('inheritance');
        component.sendNotificationEmail(ace);
        expect(mockDetailService.sendNotificationEmailForPermission).not.toHaveBeenCalled();
      });
    });

    describe('toggleInheritance', () => {
      it('should block inheritance when it is currently inherited', () => {
        mockDetailService.blockPermissionInheritance.mockReturnValue(of(undefined));
        mockDetailService.unblockPermissionInheritance.mockReturnValue(of(undefined));
        component.collection.set(mockCollection); // has an `inherited` acl -> not blocked
        component.actionInProgress.set(null);

        component.toggleInheritance();

        expect(mockDetailService.blockPermissionInheritance).toHaveBeenCalledWith('collection-1');
        expect(component.actionInProgress()).toBeNull();
      });

      it('should unblock inheritance when it is currently blocked', () => {
        mockDetailService.blockPermissionInheritance.mockReturnValue(of(undefined));
        mockDetailService.unblockPermissionInheritance.mockReturnValue(of(undefined));
        component.collection.set(
          docWith({ contextParameters: { acls: [{ name: 'local', aces: [] }] } }),
        );
        component.actionInProgress.set(null);

        component.toggleInheritance();

        expect(mockDetailService.unblockPermissionInheritance).toHaveBeenCalledWith('collection-1');
      });

      it('should clear the in-progress flag on failure', () => {
        mockDetailService.blockPermissionInheritance.mockReturnValue(
          throwError(() => new Error('denied')),
        );
        component.collection.set(mockCollection);
        component.actionInProgress.set(null);

        component.toggleInheritance();

        expect(component.actionInProgress()).toBeNull();
      });

      it('should do nothing when another action is in progress', () => {
        mockDetailService.blockPermissionInheritance.mockClear();
        component.actionInProgress.set('trash');
        component.toggleInheritance();
        expect(mockDetailService.blockPermissionInheritance).not.toHaveBeenCalled();
      });
    });
  });

  describe('addPermission dialog result', () => {
    it('should reload when a permission was created', async () => {
      component['collectionUid'] = 'collection-1';
      mockDialog.open.mockReturnValue({ afterClosed: () => of(true) });
      component.addPermission();
      await new Promise((r) => setTimeout(r, 10));
      expect(mockDetailService.getFullDocument).toHaveBeenCalled();
    });
  });

  describe('thumbnail blob lifecycle', () => {
    const members: NuxeoDocument[] = [
      docWith({ uid: 'doc1', title: 'Doc 1', type: 'File' }),
      docWith({ uid: 'doc2', title: 'Doc 2', type: 'File' }),
    ];

    beforeEach(() => {
      component['collectionUid'] = 'collection-1';
      mockDetailService.fetchThumbnail.mockReturnValue(of(new Blob(['x'])));
      mockCollectionService.getCollectionMembers.mockReturnValue(
        of({ entries: members, totalSize: 2 }),
      );
    });

    it('should create one blob URL per member and expose it as a SafeUrl', () => {
      component.loadMembers();

      expect(created.length).toBe(2);
      const map = component.thumbnailMap();
      expect(Object.keys(map).sort()).toEqual(['doc1', 'doc2']);
    });

    it('should revoke the previous batch before loading a new one', () => {
      component.loadMembers();
      const firstBatch = [...created];
      expect(firstBatch.length).toBe(2);

      component.loadMembers();

      // Every URL from the first batch must be revoked. Without this the map was simply
      // reset to {} and the old blobs stayed alive for the life of the document — one leaked
      // batch per navigation between collections.
      for (const url of firstBatch) {
        expect(revoked, `blob ${url} was never revoked`).toContain(url);
      }
    });

    it('should revoke every outstanding blob URL on destroy', () => {
      component.loadMembers();
      const outstanding = [...created];
      expect(outstanding.length).toBeGreaterThan(0);

      fixture.destroy();

      for (const url of outstanding) {
        expect(revoked, `blob ${url} survived component destruction`).toContain(url);
      }
    });

    it('should not create a blob URL when the thumbnail request yields nothing', () => {
      mockDetailService.fetchThumbnail.mockReturnValue(of(null));
      component.loadMembers();
      expect(created.length).toBe(0);
      expect(component.thumbnailMap()).toEqual({});
    });

    it('should survive a thumbnail request that errors', () => {
      mockDetailService.fetchThumbnail.mockReturnValue(throwError(() => new Error('404')));

      // The component catches per-thumbnail so one bad blob cannot empty the listing.
      expect(() => component.loadMembers()).not.toThrow();
      expect(component.members().length).toBe(2);
    });
  });

  describe('history tab', () => {
    const entry = (over: Partial<AuditEntry> = {}): AuditEntry =>
      ({
        eventId: 'documentModified',
        eventDate: '2026-08-20T10:00:00.000Z',
        principalName: 'alice',
        category: 'eventDocumentCategory',
        comment: '',
        docLifeCycle: 'project',
        ...over,
      }) as AuditEntry;

    beforeEach(() => {
      component['collectionUid'] = 'collection-1';
      component.collection.set(mockCollection);
      mockDirectoryService.getEventTypes.mockReturnValue(of([]));
      mockDirectoryService.getEventCategories.mockReturnValue(of([]));
    });

    it('should load directory entries and the audit log when the history tab opens', () => {
      mockDirectoryService.getEventTypes.mockReturnValue(
        of([{ id: 'documentModified', displayLabel: 'Document modified' }]),
      );
      mockDirectoryService.getEventCategories.mockReturnValue(
        of([{ id: 'eventDocumentCategory', displayLabel: 'Document' }]),
      );
      mockDetailService.getAuditLog.mockReturnValue(of({ entries: [entry()], resultsCount: 1 }));

      component.onTabChange(2);

      expect(mockDirectoryService.getEventTypes).toHaveBeenCalled();
      expect(mockDetailService.getAuditLog).toHaveBeenCalled();
      expect(component.auditEntries().length).toBe(1);
      expect(component.auditTotalSize()).toBe(1);
      expect(component.auditLoading()).toBe(false);
      // Labels come from the directory, so they must be resolved rather than prettified.
      expect(component.eventLabel('documentModified')).toBe('Document modified');
      expect(component.categoryLabel('eventDocumentCategory')).toBe('Document');
    });

    it('should not reload the audit log on a second visit to the tab', () => {
      mockDetailService.getAuditLog.mockReturnValue(of({ entries: [entry()], resultsCount: 1 }));
      component.onTabChange(2);
      const callsAfterFirst = mockDetailService.getAuditLog.mock.calls.length;
      component.onTabChange(0);
      component.onTabChange(2);
      expect(mockDetailService.getAuditLog.mock.calls.length).toBe(callsAfterFirst);
    });

    it('should not query the audit log for a document the user cannot audit', () => {
      // `canViewDocumentAuditLog` requires `Read` in the permissions enricher. Dropping it
      // must produce an empty history rather than a request the server would reject.
      component.collection.set(docWith({ contextParameters: { permissions: [] } }));
      mockDetailService.getAuditLog.mockClear();

      component.loadAuditLog();

      expect(mockDetailService.getAuditLog).not.toHaveBeenCalled();
      expect(component.auditEntries()).toEqual([]);
      expect(component.auditTotalSize()).toBe(0);
      expect(component.auditLoading()).toBe(false);
    });

    it('should do nothing without a collection uid', () => {
      component['collectionUid'] = '';
      mockDetailService.getAuditLog.mockClear();
      component.loadAuditLog();
      expect(mockDetailService.getAuditLog).not.toHaveBeenCalled();
    });

    it('should clear loading and allow a retry when the audit request fails', () => {
      mockDetailService.getAuditLog.mockReturnValue(throwError(() => new Error('500')));

      component.loadAuditLog();

      expect(component.auditLoading()).toBe(false);
      // Deliberately NOT marked loaded, so reopening the tab retries rather than showing
      // an empty history forever.
      expect(component['historyLoaded']).toBe(false);
    });

    it('should re-query with the new page on pagination', () => {
      mockDetailService.getAuditLog.mockReturnValue(of({ entries: [], resultsCount: 0 }));
      component.onAuditPageChange({ pageSize: 50, pageIndex: 2, length: 100 } as PageEvent);
      expect(component.auditPageSize()).toBe(50);
      expect(component.auditPageIndex()).toBe(2);
      expect(mockDetailService.getAuditLog).toHaveBeenCalledWith('collection-1', 50, 2);
    });

    it('should record the sort without re-querying, since sorting is in-memory', () => {
      mockDetailService.getAuditLog.mockClear();
      component.onAuditSort({ active: 'eventDate', direction: 'desc' } as Sort);
      expect(component['sortActive']()).toBe('eventDate');
      expect(component['sortDirection']()).toBe('desc');
      expect(mockDetailService.getAuditLog).not.toHaveBeenCalled();
    });

    it('should fall back to a prettified label when the directory has no entry', () => {
      expect(component.eventLabel('documentCheckedIn')).toBe('Document Checked In');

      // NOTE: asserts what the code *does*, and it is not what the code *intends*.
      //
      // `categoryLabel()` ends with `.replace('event ', '').replace(' Category', '')`, but the
      // preceding `.replace(/^./, c => c.toUpperCase())` has already capitalised the string to
      // "Event Life Cycle Category". The lowercase `'event '` pattern therefore never matches
      // and that replace is dead code — the evident intent was "Life Cycle".
      //
      // Asserted as-is rather than fixed: changing it alters user-visible category labels on the
      // history tab, which is a product decision and not a side effect a coverage task should
      // make. Recorded here so the next person sees a documented defect instead of rediscovering
      // it, and so fixing it turns this assertion red on purpose.
      expect(component.categoryLabel('eventLifeCycleCategory')).toBe('Event Life Cycle');
    });

    describe('filteredAuditEntries', () => {
      beforeEach(() => {
        component.auditEntries.set([
          entry({ principalName: 'alice', eventDate: '2026-08-10T10:00:00.000Z' }),
          entry({
            principalName: 'bob',
            eventId: 'documentCreated',
            category: 'eventLifeCycleCategory',
            eventDate: '2026-08-20T10:00:00.000Z',
          }),
          entry({ principalName: 'carol', eventDate: '2026-08-30T10:00:00.000Z' }),
        ]);
        component.filterUsername.set('');
        component.filterDateFrom.set(null);
        component.filterDateTo.set(null);
        component.filterAction.set('');
        component.filterCategory.set('');
        component['sortActive'].set('');
        component['sortDirection'].set('');
      });

      it('should return everything when no filter is set', () => {
        expect(component.filteredAuditEntries().length).toBe(3);
      });

      it('should filter by username, case-insensitively', () => {
        component.filterUsername.set('ALI');
        const r = component.filteredAuditEntries();
        expect(r.length).toBe(1);
        expect(r[0].principalName).toBe('alice');
      });

      it('should filter by a start date', () => {
        component.filterDateFrom.set(new Date('2026-08-20T00:00:00.000Z'));
        expect(component.filteredAuditEntries().map((e) => e.principalName)).toEqual([
          'bob',
          'carol',
        ]);
      });

      it('should include the whole of the end date, not midnight', () => {
        // The implementation pushes `dateTo` to 23:59:59.999 on purpose. A naive
        // comparison would drop every entry recorded later in the selected day.
        component.filterDateTo.set(new Date('2026-08-20T00:00:00.000Z'));
        expect(component.filteredAuditEntries().map((e) => e.principalName)).toEqual([
          'alice',
          'bob',
        ]);
      });

      it('should filter by action and by category', () => {
        component.filterAction.set('documentCreated');
        expect(component.filteredAuditEntries().length).toBe(1);
        component.filterAction.set('');
        component.filterCategory.set('eventLifeCycleCategory');
        expect(component.filteredAuditEntries().length).toBe(1);
      });

      it('should sort ascending and descending without mutating the source', () => {
        const before = component.auditEntries().map((e) => e.principalName);

        component['sortActive'].set('principalName');
        component['sortDirection'].set('asc');
        expect(component.filteredAuditEntries().map((e) => e.principalName)).toEqual([
          'alice',
          'bob',
          'carol',
        ]);

        component['sortDirection'].set('desc');
        expect(component.filteredAuditEntries().map((e) => e.principalName)).toEqual([
          'carol',
          'bob',
          'alice',
        ]);

        // The sort copies the array; sorting the signal's own value in place would make the
        // displayed order depend on how many times the computed had been read.
        expect(component.auditEntries().map((e) => e.principalName)).toEqual(before);
      });

      it('should combine a filter with a sort', () => {
        component.filterCategory.set('eventDocumentCategory');
        component['sortActive'].set('principalName');
        component['sortDirection'].set('desc');
        expect(component.filteredAuditEntries().map((e) => e.principalName)).toEqual([
          'carol',
          'alice',
        ]);
      });
    });
  });

  describe('loadMembers', () => {
    it('should load collection members', () => {
      component['collectionUid'] = 'collection-1';
      mockCollectionService.getCollectionMembers.mockReturnValue(
        of({
          entries: [
            docWith({ uid: 'doc1', title: 'Doc 1' }),
            docWith({ uid: 'doc2', title: 'Doc 2' }),
          ],
          totalSize: 2,
        }),
      );

      component.loadMembers();

      expect(mockCollectionService.getCollectionMembers).toHaveBeenCalledWith('collection-1', 50);
      expect(component.members().length).toBe(2);
      expect(component.totalSize()).toBe(2);
    });
  });

  describe('shareCollection', () => {
    it('should open share dialog', () => {
      component.collection.set(mockCollection);
      component.shareCollection();
      expect(mockDialog.open).toHaveBeenCalled();
    });
  });

  describe('permissionLabel', () => {
    it('should return label for known permissions', () => {
      expect(component.permissionLabel('Everything')).toBe('Manage everything');
      expect(component.permissionLabel('ReadWrite')).toBe('Edit');
      expect(component.permissionLabel('Read')).toBe('Read');
    });

    it('should return original permission for unknown permissions', () => {
      expect(component.permissionLabel('UnknownPermission')).toBe('UnknownPermission');
    });
  });

  describe('aceTimeFrame', () => {
    it('should return Permanent when no begin/end', () => {
      const ace = { begin: null, end: null } as any;
      expect(component.aceTimeFrame(ace)).toBe('Permanent');
    });

    it('should format date range when both present', () => {
      const ace = {
        begin: '2026-01-01T00:00:00.000Z',
        end: '2026-12-31T00:00:00.000Z',
      } as any;
      // `permissions.time-frame.range` separates the two dates. The previous `from X to Y` was
      // built by interpolation, so it was English in every locale.
      expect(component.aceTimeFrame(ace)).toMatch(/^\w{3} \d{2}, 2026 - \w{3} \d{2}, 2026$/);
    });

    it('should format from date when only begin present', () => {
      const ace = { begin: '2026-01-01T00:00:00.000Z', end: null } as any;
      expect(component.aceTimeFrame(ace)).toMatch(/^From \w{3} \d{2}, 2026$/);
    });

    it('should format until date when only end present', () => {
      const ace = { begin: null, end: '2026-12-31T00:00:00.000Z' } as any;
      const result = component.aceTimeFrame(ace);
      expect(result).toContain('Until');
    });
  });

  describe('addPermission', () => {
    it('should open add permission dialog', () => {
      component['collectionUid'] = 'collection-1';
      mockDialog.open.mockReturnValue({ afterClosed: () => of(undefined) });
      component.addPermission();
      expect(mockDialog.open).toHaveBeenCalled();
    });

    it('should reload collection after adding permission', async () => {
      component['collectionUid'] = 'collection-1';
      mockDialog.open.mockReturnValue({ afterClosed: () => of(true) });
      component.addPermission();

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(mockDetailService.getFullDocument).toHaveBeenCalled();
    });
  });

  describe('avatarColor', () => {
    it('should have avatarColor function available', () => {
      expect(component.avatarColor).toBeDefined();
      expect(typeof component.avatarColor).toBe('function');
    });
  });

  /**
   * A stale members response must not replace a newer collection's.
   *
   * The thumbnail generation does not cover this: it is minted from *inside* the members response, so
   * it orders thumbnail batches against each other and leaves the members request itself unguarded.
   * Navigating A -> B starts two member requests; with B resolving first, A's late response overwrote
   * `members` and `totalSize`, and its `loadThumbnails` then took the newest thumbnail generation and
   * discarded B's images too — so the older collection won outright.
   */
  describe('overlapping member requests', () => {
    function docs(...uids: string[]): NuxeoDocument[] {
      return uids.map((uid) => ({ uid, title: uid, type: 'File' }) as unknown as NuxeoDocument);
    }

    it('ignores a members response superseded by a newer load', () => {
      const first = new Subject<{ entries: NuxeoDocument[]; totalSize: number }>();
      const second = new Subject<{ entries: NuxeoDocument[]; totalSize: number }>();
      mockCollectionService.getCollectionMembers
        .mockReturnValueOnce(first.asObservable())
        .mockReturnValueOnce(second.asObservable());

      component.loadMembers();
      component.loadMembers();

      // The later request resolves first.
      second.next({ entries: docs('doc-B'), totalSize: 1 });
      second.complete();
      expect(component.members().map((d) => d.uid)).toEqual(['doc-B']);

      // The earlier one lands afterwards and must be discarded.
      first.next({ entries: docs('doc-A'), totalSize: 99 });
      first.complete();
      expect(component.members().map((d) => d.uid)).toEqual(['doc-B']);
      expect(component.totalSize()).toBe(1);
    });

    it('ignores a stale failure rather than showing an error over newer results', () => {
      const first = new Subject<{ entries: NuxeoDocument[]; totalSize: number }>();
      const second = new Subject<{ entries: NuxeoDocument[]; totalSize: number }>();
      mockCollectionService.getCollectionMembers
        .mockReturnValueOnce(first.asObservable())
        .mockReturnValueOnce(second.asObservable());

      component.loadMembers();
      component.loadMembers();

      second.next({ entries: docs('doc-B'), totalSize: 1 });
      second.complete();

      first.error(new Error('boom'));
      expect(component.error()).toBeNull();
      expect(component.loading()).toBe(false);
      expect(component.members().map((d) => d.uid)).toEqual(['doc-B']);
    });

    it('still applies a members response that nothing superseded', () => {
      // The positive control, so the guard is discriminating rather than dropping everything.
      const only = new Subject<{ entries: NuxeoDocument[]; totalSize: number }>();
      mockCollectionService.getCollectionMembers.mockReturnValueOnce(only.asObservable());

      component.loadMembers();
      only.next({ entries: docs('doc-A'), totalSize: 1 });
      only.complete();

      expect(component.members().map((d) => d.uid)).toEqual(['doc-A']);
      expect(component.loading()).toBe(false);
    });
  });
});
