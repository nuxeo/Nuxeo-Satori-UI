import { provideZonelessChangeDetection, signal } from '@angular/core';
import { testTranslateModule } from '@agentic-ui/testing/i18n';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideRouter, withDisabledInitialNavigation } from '@angular/router';
import { EMPTY, Subject, of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { AppConfigService } from '@nuxeo/satori-platform/app-config';
import {
  ADMIN_ACCESS_CHECKS,
  BrowseService,
  CURRENT_USERNAME,
  DirectoryService,
  DocumentDetailService,
  DocumentImportService,
  SelectionService,
  TagService,
  type NuxeoAce,
  type NuxeoAcl,
  type NuxeoDocument,
} from '@nuxeo/satori-platform/nuxeo-client';

import { BrowseComponent } from './browse';
import {
  NxsShareExternalDialogComponent,
  NxsToastService,
  NxsUpdatePermissionDialogComponent,
} from '@nuxeo/satori-platform/components';

function doc(overrides: Partial<NuxeoDocument> & Pick<NuxeoDocument, 'uid'>): NuxeoDocument {
  return {
    title: 'Workspace',
    type: 'Workspace',
    path: '/default-domain/workspaces/ws-1',
    lastModified: '2026-01-01T00:00:00.000Z',
    properties: {},
    ...overrides,
  };
}

function ace(overrides: Partial<NuxeoAce> & Pick<NuxeoAce, 'id'>): NuxeoAce {
  return {
    username: 'members',
    externalUser: false,
    permission: 'Read',
    granted: true,
    creator: 'Administrator',
    begin: null,
    end: null,
    status: 'effective',
    ...overrides,
  };
}

function withAcls(acls: NuxeoAcl[], permissions: string[] = ['Everything']): NuxeoDocument {
  return doc({ uid: 'ws-1', contextParameters: { acls, permissions } });
}

const emptyAuditLog = {
  entries: [],
  totalSize: 0,
  currentPageSize: 0,
  currentPageIndex: 0,
  numberOfPages: 0,
};

type BrowseReturn<K extends keyof BrowseService> = ReturnType<BrowseService[K]>;
type DetailReturn<K extends keyof DocumentDetailService> = ReturnType<DocumentDetailService[K]>;

const browse = {
  getByPath: vi.fn((): BrowseReturn<'getByPath'> => EMPTY),
  getBrowseFolderContents: vi.fn((): BrowseReturn<'getBrowseFolderContents'> => EMPTY),
  // Default EMPTY: the folder scan never resolves, so the toolbar filters fall back to the
  // loaded page exactly as they did before cross-folder filtering existed. A spec that wants the
  // whole-folder behaviour overrides this with its own `of({ entries, truncated })`.
  getBrowseFolderTypes: vi.fn((): BrowseReturn<'getBrowseFolderTypes'> => EMPTY),
  getFolderContext: vi.fn((): BrowseReturn<'getFolderContext'> => EMPTY),
  getChildren: vi.fn((): BrowseReturn<'getChildren'> => EMPTY),
  hasChildCollections: vi.fn((): BrowseReturn<'hasChildCollections'> => of(false)),
  getTrashedChildren: vi.fn((): BrowseReturn<'getTrashedChildren'> => EMPTY),
  restoreDocument: vi.fn((): BrowseReturn<'restoreDocument'> => EMPTY),
  startCsvExport: vi.fn((): BrowseReturn<'startCsvExport'> => EMPTY),
  pollAndDownloadCsv: vi.fn((): BrowseReturn<'pollAndDownloadCsv'> => EMPTY),
};

const detail = {
  getFullDocument: vi.fn((): DetailReturn<'getFullDocument'> => EMPTY),
  getDocumentPermissions: vi.fn((): DetailReturn<'getDocumentPermissions'> => EMPTY),
  fetchThumbnail: vi.fn((): DetailReturn<'fetchThumbnail'> => EMPTY),
  getAuditLog: vi.fn((): DetailReturn<'getAuditLog'> => of(emptyAuditLog)),
  trashDocument: vi.fn((): DetailReturn<'trashDocument'> => EMPTY),
  blockPermissionInheritance: vi.fn((): DetailReturn<'blockPermissionInheritance'> => EMPTY),
  unblockPermissionInheritance: vi.fn((): DetailReturn<'unblockPermissionInheritance'> => EMPTY),
  sendNotificationEmailForPermission: vi.fn(
    (): DetailReturn<'sendNotificationEmailForPermission'> => EMPTY,
  ),
};

const manifest = signal<{ extensionLayers: readonly unknown[] }>({ extensionLayers: [] });

/**
 * The Permissions tab's host half: the external-user list, its dialogs and the load that feeds it.
 *
 * Local and inherited permissions and the inheritance toggle are `nxs-permissions-panel`'s, and
 * are specified in `libs/shared/satori-components`. `browse.spec.ts` covers the notification-email
 * pair; it is not repeated here.
 */
describe('BrowseComponent — permissions tab', () => {
  let component: BrowseComponent;
  let fixture: ComponentFixture<BrowseComponent>;
  let toast: { show: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  let dialogOpen: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    toast = { show: vi.fn(), error: vi.fn() };
    TestBed.overrideProvider(NxsToastService, { useValue: toast });
    dialogOpen = vi.fn(() => ({ afterClosed: () => of(undefined) }));
    // `vi.clearAllMocks()` clears recorded calls but keeps implementations, and the
    // component issues its first folder request from the constructor — so without
    // this reset each test inherits the previous test's listing.
    browse.getBrowseFolderContents.mockReturnValue(EMPTY);
    browse.getFolderContext.mockReturnValue(EMPTY);
    detail.getDocumentPermissions.mockReturnValue(EMPTY);
    detail.blockPermissionInheritance.mockReturnValue(EMPTY);
    detail.unblockPermissionInheritance.mockReturnValue(EMPTY);
    detail.sendNotificationEmailForPermission.mockReturnValue(EMPTY);
    detail.getAuditLog.mockReturnValue(of(emptyAuditLog));

    manifest.set({ extensionLayers: [] });
    await TestBed.configureTestingModule({
      imports: [testTranslateModule(), testTranslateModule(), BrowseComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([], withDisabledInitialNavigation()),
        { provide: BrowseService, useValue: browse },
        { provide: DocumentImportService, useValue: { importFiles: () => EMPTY } },
        { provide: DocumentDetailService, useValue: detail },
        {
          provide: DirectoryService,
          useValue: { getEventTypes: vi.fn(() => of([])), getEventCategories: vi.fn(() => of([])) },
        },
        { provide: TagService, useValue: { searchTags: vi.fn(() => of([])) } },
        { provide: CURRENT_USERNAME, useValue: () => 'jdoe' },
        {
          provide: ADMIN_ACCESS_CHECKS,
          useValue: {
            isAdministrator: () => false,
            isPowerUser: () => false,
            hasAdministrationAccess: () => false,
          },
        },
        { provide: MatDialog, useValue: { open: dialogOpen } },
        { provide: AppConfigService, useValue: { manifest } },
      ],
    })
      .overrideComponent(BrowseComponent, { set: { imports: [], template: '<div></div>' } })
      .compileComponents();

    fixture = TestBed.createComponent(BrowseComponent);
    component = fixture.componentInstance;
    TestBed.inject(SelectionService).clear();
  });

  afterEach(() => fixture.destroy());

  function dialogData<T>(call = 0): T {
    return (dialogOpen.mock.calls[call][1] as { data: T }).data;
  }

  // ── Derived ACL lists ──

  it('keeps only the external grants, which the host shows beside the panel', () => {
    component.currentDoc.set(
      withAcls([
        {
          name: 'local',
          aces: [
            ace({ id: 'l-1', username: 'members' }),
            ace({ id: 'l-2', username: 'transient/guest@example.com', externalUser: true }),
          ],
        },
        {
          name: 'inherited',
          aces: [
            ace({ id: 'i-1', username: 'administrators', permission: 'Everything' }),
            ace({ id: 'i-2', username: 'revoked', granted: false }),
          ],
        },
      ]),
    );

    expect(component.externalAces().map((a) => a.id)).toEqual(['l-2']);
  });

  it('renders the local and inherited permissions through the library panel ID', () => {
    expect(component.permissionsPanelId).toBe('nxs.components.permissionsPanel');
  });

  it('yields no external grants before the document has loaded', () => {
    expect(component.externalAces()).toEqual([]);
  });

  it('yields no external grants for a document loaded without the acls enricher', () => {
    component.currentDoc.set(doc({ uid: 'ws-1', contextParameters: {} }));

    expect(component.externalAces()).toEqual([]);
  });

  // ── Loading ──

  it('merges the permissions response into the existing document rather than replacing it', () => {
    component.currentDoc.set(
      doc({ uid: 'ws-1', contextParameters: { favorites: { isFavorite: true } } }),
    );
    detail.getDocumentPermissions.mockReturnValue(
      of(withAcls([{ name: 'local', aces: [ace({ id: 'l-1', externalUser: true })] }])),
    );

    component.onTabChange(1);

    expect(component.currentDoc()?.contextParameters?.['favorites']).toEqual({ isFavorite: true });
    expect(component.externalAces().map((a) => a.id)).toEqual(['l-1']);
  });

  it('does not request permissions for a tab opened before any document has loaded', () => {
    component.onTabChange(1);

    expect(detail.getDocumentPermissions).not.toHaveBeenCalled();
    expect(component.permissionsLoaded()).toBe(false);
    expect(component.permissionsLoading()).toBe(false);
  });

  it('surfaces a failed permissions load and clears the loading flag', () => {
    component.currentDoc.set(doc({ uid: 'ws-1' }));
    detail.getDocumentPermissions.mockReturnValue(throwError(() => ({ status: 500 })));

    component.onTabChange(1);

    expect(component.permissionsLoading()).toBe(false);
    expect(component.permissionsLoaded()).toBe(false);
    expect(toast.error).toHaveBeenCalledWith('Failed to load permissions');
  });

  it('does not issue a second permissions request while the first is in flight', () => {
    component.currentDoc.set(doc({ uid: 'ws-1' }));
    detail.getDocumentPermissions.mockReturnValue(new Subject<never>());

    component.onTabChange(1);
    component.onTabChange(1);

    expect(detail.getDocumentPermissions).toHaveBeenCalledTimes(1);
    expect(component.permissionsLoading()).toBe(true);
  });

  // ── Add / edit / delete ──

  it('deletePermission shows the human-readable permission and timeframe in the confirmation', () => {
    component.currentDoc.set(doc({ uid: 'ws-1' }));
    detail.getDocumentPermissions.mockReturnValue(of(withAcls([{ name: 'local', aces: [] }])));
    dialogOpen.mockReturnValue({ afterClosed: () => of(true) });
    const target = ace({ id: 'l-1', permission: 'ReadWrite', end: '2026-12-31T00:00:00.000Z' });

    component.deletePermission(target);

    const data = dialogData<{ permissionLabel: string; timeFrameLabel: string }>();
    expect(data.permissionLabel).toBe('Edit');
    expect(data.timeFrameLabel).toContain('Until');
    expect(toast.show).toHaveBeenCalledWith('Permission deleted');
  });

  it('deletePermission leaves the ACLs alone when the confirmation is dismissed', () => {
    component.currentDoc.set(doc({ uid: 'ws-1' }));
    dialogOpen.mockReturnValue({ afterClosed: () => of(false) });

    component.deletePermission(ace({ id: 'l-1' }));

    expect(detail.getDocumentPermissions).not.toHaveBeenCalled();
    expect([...toast.show.mock.calls, ...toast.error.mock.calls]).toEqual([]);
  });

  // A section root's list, so a fixed table could not pass: it holds CanAskForPublishing and
  // not ReadCanCollect.
  const SECTION_RIGHTS = ['Read', 'ReadWrite', 'Everything', 'CanAskForPublishing'];

  /** Opens the Permissions tab on `ws-1`, whose permissions read reports `rights`. */
  function openPermissionsWith(rights?: string[]): void {
    component.currentDoc.set(doc({ uid: 'ws-1' }));
    const context: Record<string, unknown> = { acls: [], permissions: ['Everything'] };
    if (rights) context['userVisiblePermissions'] = rights;
    detail.getDocumentPermissions.mockReturnValue(
      of(doc({ uid: 'ws-1', contextParameters: context })),
    );
    component.onTabChange(1);
  }

  it("shareWithExternal opens the nxs dialog with the type's userVisiblePermissions", () => {
    openPermissionsWith(SECTION_RIGHTS);

    component.shareWithExternal();

    expect(dialogOpen).toHaveBeenCalledWith(NxsShareExternalDialogComponent, {
      maxWidth: '95vw',
      data: { documentUid: 'ws-1', permissions: SECTION_RIGHTS },
    });
  });

  it("editExternalPermission opens the nxs dialog with the type's userVisiblePermissions", () => {
    openPermissionsWith(SECTION_RIGHTS);
    const share = ace({ id: 'x-1', externalUser: true });

    component.editExternalPermission(share);

    expect(dialogOpen).toHaveBeenCalledWith(NxsUpdatePermissionDialogComponent, {
      maxWidth: '95vw',
      data: { documentUid: 'ws-1', ace: share, permissions: SECTION_RIGHTS },
    });
  });

  it('hands both dialogs no list when the permissions read did not report one', () => {
    openPermissionsWith(undefined);

    component.shareWithExternal();
    component.editExternalPermission(ace({ id: 'x-1', externalUser: true }));

    expect(dialogData<{ permissions?: unknown }>(0).permissions).toBeUndefined();
    expect(dialogData<{ permissions?: unknown }>(1).permissions).toBeUndefined();
  });

  it("keeps the type's rights when a listing refresh replaces the folder with a read that lacks them", () => {
    openPermissionsWith(SECTION_RIGHTS);
    // What sorting or paging the same folder does: `getByPath` asks for acls, not the rights.
    component.currentDoc.set(withAcls([{ name: 'local', aces: [] }]));

    component.shareWithExternal();

    expect(dialogData<{ permissions?: unknown }>().permissions).toEqual(SECTION_RIGHTS);
  });

  it("does not offer one folder's rights on another", () => {
    openPermissionsWith(SECTION_RIGHTS);
    component.currentDoc.set(doc({ uid: 'ws-2' }));

    component.shareWithExternal();

    expect(dialogData<{ documentUid: string; permissions?: unknown }>()).toEqual({
      documentUid: 'ws-2',
      permissions: undefined,
    });
  });

  describe('a permissions answer for a folder the user has moved on from', () => {
    const sharedWith = (uid: string, id: string): NuxeoDocument =>
      doc({
        uid,
        contextParameters: {
          acls: [{ name: 'local', aces: [ace({ id, externalUser: true })] }],
          permissions: ['Everything'],
          userVisiblePermissions: SECTION_RIGHTS,
        },
      });
    /** What the router does on a new browse URL: the tab resets before the listing arrives. */
    const navigate = () => component['resetBrowseTabState']();
    /** The new folder's listing arriving, as `getBrowseFolderContents` answers it. */
    function listingArrives(uid: string): void {
      browse.getBrowseFolderContents.mockReturnValue(
        of({ folder: doc({ uid }), entries: [], totalSize: 0 }),
      );
      component.loadContent();
    }
    function openTabOn(uid: string): Subject<NuxeoDocument> {
      component.currentDoc.set(doc({ uid }));
      const answer = new Subject<NuxeoDocument>();
      detail.getDocumentPermissions.mockReturnValueOnce(answer);
      component.onTabChange(1);
      return answer;
    }

    it('is not applied after navigation, so the next folder still loads its own', () => {
      const stale = openTabOn('ws-1');
      navigate();

      stale.next(sharedWith('ws-1', 'stale'));

      expect(component.permissionsLoaded()).toBe(false);
      expect(component.externalAces()).toEqual([]);
    });

    it('reports no failure for the folder the user has left', () => {
      const stale = openTabOn('ws-1');
      navigate();

      stale.error({ status: 500 });

      expect(toast.error).not.toHaveBeenCalled();
    });

    it('cannot overwrite a newer read of the same folder after a return to it', () => {
      const first = openTabOn('ws-1');
      navigate(); // to another folder…
      navigate(); // …and back
      detail.getDocumentPermissions.mockReturnValueOnce(of(sharedWith('ws-1', 'fresh')));
      component.onTabChange(1);

      first.next(sharedWith('ws-1', 'stale'));

      expect(component.externalAces().map((a) => a.id)).toEqual(['fresh']);
    });

    it('is discarded when the new listing lands first, and the new folder is read instead', () => {
      navigate();
      // The tab opened before the listing arrived, so `currentDoc` is still the old folder.
      const stale = openTabOn('ws-1');
      detail.getDocumentPermissions.mockReturnValue(of(sharedWith('ws-2', 'own')));

      listingArrives('ws-2');
      stale.next(sharedWith('ws-1', 'stale'));

      expect(detail.getDocumentPermissions).toHaveBeenLastCalledWith('ws-2');
      expect(component.permissionsLoading()).toBe(false);
      expect(component.externalAces().map((a) => a.id)).toEqual(['own']);
    });

    it('does not stand in for the new folder when it lands before the new listing', () => {
      navigate();
      const early = openTabOn('ws-1');
      early.next(sharedWith('ws-1', 'old'));
      detail.getDocumentPermissions.mockReturnValue(of(sharedWith('ws-2', 'own')));

      listingArrives('ws-2');

      expect(detail.getDocumentPermissions).toHaveBeenLastCalledWith('ws-2');
      expect(component.externalAces().map((a) => a.id)).toEqual(['own']);
    });
  });

  it('lists only the document’s own pending and effective external shares', () => {
    component.currentDoc.set(
      withAcls([
        {
          name: 'local',
          aces: [
            ace({ id: 'own', externalUser: true, status: 'effective' }),
            ace({ id: 'pending', externalUser: true, status: 'pending' }),
            ace({ id: 'expired', externalUser: true, status: 'archived' }),
          ],
        },
        { name: 'inherited', aces: [ace({ id: 'parent', externalUser: true })] },
      ]),
    );

    expect(component.externalAces().map((a) => a.id)).toEqual(['own', 'pending']);
  });

  it('shows a share’s end as the day its writer picked, as the update dialog reads it', () => {
    // Midnight on 15 July in UTC+12, which the suite's zone (UTC+5:30) reads as 14 July locally.
    const share = ace({ id: 'x-1', externalUser: true, end: '2030-07-14T12:00:00.000Z' });
    // Built from the same `Intl` call for that day, so ICU data cannot make it brittle.
    const fifteenth = new Date('2030-07-15').toLocaleDateString(component['locale'], {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });

    expect(component.aceTimeFrame(share)).toBe(`Until ${fifteenth}`);
  });

  it('shareWithExternal reloads the ACLs only when a share was created', () => {
    component.currentDoc.set(doc({ uid: 'ws-1' }));
    detail.getDocumentPermissions.mockReturnValue(of(withAcls([{ name: 'local', aces: [] }])));

    dialogOpen.mockReturnValue({ afterClosed: () => of(undefined) });
    component.shareWithExternal();
    expect(detail.getDocumentPermissions).not.toHaveBeenCalled();

    dialogOpen.mockReturnValue({ afterClosed: () => of(true) });
    component.shareWithExternal();
    expect(detail.getDocumentPermissions).toHaveBeenCalledWith('ws-1');
    // The dialog announces the share itself; a second toast from the page would repeat it.
    expect(toast.show).not.toHaveBeenCalled();
  });

  it('editExternalPermission reloads the ACLs only when the share was updated', () => {
    component.currentDoc.set(doc({ uid: 'ws-1' }));
    detail.getDocumentPermissions.mockReturnValue(of(withAcls([{ name: 'local', aces: [] }])));

    dialogOpen.mockReturnValue({ afterClosed: () => of(false) });
    component.editExternalPermission(ace({ id: 'x-1', externalUser: true }));
    expect(detail.getDocumentPermissions).not.toHaveBeenCalled();

    dialogOpen.mockReturnValue({ afterClosed: () => of(true) });
    component.editExternalPermission(ace({ id: 'x-1', externalUser: true }));
    expect(detail.getDocumentPermissions).toHaveBeenCalledWith('ws-1');
    expect(toast.show).not.toHaveBeenCalled();
  });

  it('opens no permission dialog at all without a browsed document', () => {
    component.deletePermission(ace({ id: 'l-1' }));
    component.shareWithExternal();
    component.editExternalPermission(ace({ id: 'l-1' }));
    component.sendNotificationEmail(ace({ id: 'l-1' }));

    expect(dialogOpen).not.toHaveBeenCalled();
    expect(detail.sendNotificationEmailForPermission).not.toHaveBeenCalled();
  });

  it('sendNotificationEmail ignores a second press while a send is running', () => {
    component.currentDoc.set(doc({ uid: 'ws-1' }));
    detail.sendNotificationEmailForPermission.mockReturnValue(new Subject<never>());

    component.sendNotificationEmail(ace({ id: 'l-1' }));
    component.sendNotificationEmail(ace({ id: 'l-1' }));

    expect(detail.sendNotificationEmailForPermission).toHaveBeenCalledTimes(1);
    expect(component.actionInProgress()).toBe('notify-l-1');
  });

  it('sendNotificationEmail reports a generic failure that is not an SMTP failure', () => {
    component.currentDoc.set(doc({ uid: 'ws-1' }));
    detail.sendNotificationEmailForPermission.mockReturnValue(throwError(() => ({ status: 500 })));

    component.sendNotificationEmail(ace({ id: 'l-1' }));

    expect(component.actionInProgress()).toBeNull();
    expect(toast.error).toHaveBeenCalledWith('Failed to send notification', { duration: 7000 });
    expect(toast.error).not.toHaveBeenCalledWith(
      'Notification email could not be sent. Configure outbound mail (SMTP) on the Nuxeo server.',
      { duration: 7000 },
    );
  });

  // ── ACE presentation ──

  it('permissionIcon distinguishes the four named permissions and locks the rest', () => {
    expect(component.permissionIcon('Everything')).toBe('admin_panel_settings');
    expect(component.permissionIcon('ReadWrite')).toBe('edit');
    expect(component.permissionIcon('Read')).toBe('visibility');
    expect(component.permissionIcon('Write')).toBe('create');
    expect(component.permissionIcon('ReadCanCollect')).toBe('lock');
  });

  it('permissionLabel translates the known permissions and passes anything else through', () => {
    expect(component.permissionLabel('Everything')).toBe('Manage everything');
    expect(component.permissionLabel('ReadWrite')).toBe('Edit');
    expect(component.permissionLabel('ReadRemove')).toBe('Read & Remove');
    expect(component.permissionLabel('AddChildren')).toBe('Add Children');
    expect(component.permissionLabel('ManageWorkflows')).toBe('Manage Workflows');
    expect(component.permissionLabel('ReadCanCollect')).toBe('Can collect');
    expect(component.permissionLabel('CustomFromMarketplace')).toBe('CustomFromMarketplace');
  });

  it('aceTimeFrame covers permanent, open-ended, until-only and bounded ACEs', () => {
    // Every shape now resolves a `permissions.time-frame.*` key from the real catalogue rather
    // than interpolating an English connective, so these assert the catalogue's wording. The
    // bounded case reads as a range because that is what `permissions.time-frame.range` says;
    // it used to be assembled as `from X to Y`, which no catalogue entry could ever have reached.
    expect(component.aceTimeFrame(ace({ id: 'a' }))).toBe('Permanent');
    expect(component.aceTimeFrame(ace({ id: 'b', end: '2026-12-31T00:00:00.000Z' }))).toMatch(
      /^Until \w{3} \d{2}, 2026$/,
    );
    expect(component.aceTimeFrame(ace({ id: 'c', begin: '2026-07-01T00:00:00.000Z' }))).toMatch(
      /^From \w{3} \d{2}, 2026$/,
    );
    expect(
      component.aceTimeFrame(
        ace({ id: 'd', begin: '2026-07-01T00:00:00.000Z', end: '2026-12-31T00:00:00.000Z' }),
      ),
    ).toMatch(/^\w{3} \d{2}, 2026 - \w{3} \d{2}, 2026$/);
  });

  it('aceTimeFrame resolves catalogue keys rather than leaking them', () => {
    // The failure this guards is the one the old implementation could not have: a missing or
    // misspelled key makes ngx-translate pass the key straight through, so the cell would read
    // `permissions.time-frame.range` to the user.
    const shapes = [
      ace({ id: 'a' }),
      ace({ id: 'b', end: '2026-12-31T00:00:00.000Z' }),
      ace({ id: 'c', begin: '2026-07-01T00:00:00.000Z' }),
      ace({ id: 'd', begin: '2026-07-01T00:00:00.000Z', end: '2026-12-31T00:00:00.000Z' }),
    ];
    for (const shape of shapes) {
      expect(component.aceTimeFrame(shape)).not.toContain('permissions.time-frame');
    }
  });

  it('displayUsername strips the transient prefix from an externally shared principal', () => {
    expect(
      component.displayUsername(ace({ id: 'a', username: 'transient/guest@example.com' })),
    ).toBe('guest@example.com');
    expect(component.displayUsername(ace({ id: 'b', username: 'members' }))).toBe('members');
  });

  it('aceGrantedBy falls back to a dash when the ACE records no creator', () => {
    expect(component.aceGrantedBy(ace({ id: 'a', creator: 'Administrator' }))).toBe(
      'Administrator',
    );
    expect(component.aceGrantedBy(ace({ id: 'b', creator: null }))).toBe('—');
    expect(component.aceGrantedBy(ace({ id: 'c', creator: '' }))).toBe('—');
  });
});
