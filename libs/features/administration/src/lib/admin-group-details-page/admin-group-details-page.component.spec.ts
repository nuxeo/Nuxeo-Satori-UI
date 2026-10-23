import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, LOCALE_ID } from '@angular/core';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { testTranslateModule } from '@agentic-ui/testing/i18n';
import { describe, it, expect, vi, beforeEach, type MockInstance } from 'vitest';
import { of, throwError, BehaviorSubject, Subject } from 'rxjs';

import {
  UserService,
  PrincipalPermissionsService,
  DocumentDetailService,
  NuxeoGroup,
  PrincipalPermissionPage,
  PrincipalPermissionRow,
} from '@nuxeo/satori-platform/nuxeo-client';
import { AdminGroupDetailsPageComponent } from './admin-group-details-page.component';
import { PageEvent } from '@angular/material/paginator';

describe('AdminGroupDetailsPageComponent', () => {
  let component: AdminGroupDetailsPageComponent;
  let fixture: ComponentFixture<AdminGroupDetailsPageComponent>;
  let mockUserService: {
    getGroup: ReturnType<typeof vi.fn>;
    updateGroup: ReturnType<typeof vi.fn>;
    deleteGroup: ReturnType<typeof vi.fn>;
  };
  let mockPermService: {
    listLocalPermissionRows: ReturnType<typeof vi.fn>;
  };
  let mockDocumentDetailService: {
    removePermission: ReturnType<typeof vi.fn>;
  };
  let mockDialog: { open: MockInstance<MatDialog['open']> };
  let mockSnackBar: { open: MockInstance<MatSnackBar['open']> };
  let mockRouter: { navigate: MockInstance<Router['navigate']> };
  let paramMapSubject: BehaviorSubject<ReturnType<typeof convertToParamMap>>;

  // `NuxeoGroup` is `{ 'entity-type', groupname, grouplabel, memberUsers?, memberGroups? }`. The
  // `id` and `properties` this fixture used to carry are not on the model at all — Vitest strips
  // the types that would have rejected them, so nothing noticed.
  const mockGroup: NuxeoGroup = {
    'entity-type': 'group',
    groupname: 'test-group',
    grouplabel: 'Test Group',
    memberUsers: ['user1', 'user2'],
    memberGroups: ['nested-group1'],
  };

  // Likewise `PrincipalPermissionRow`: `begin`, `end` and `grantedBy` are required and were absent,
  // while `aceUsername` / `aceStatus` / `aceCreator` do not exist. `begin`/`end` are what
  // `timeFrameLabel` reads, so the old fixture could not have exercised it correctly.
  const mockLocalPerms: PrincipalPermissionPage = {
    rows: [
      {
        documentUid: 'doc-1',
        documentTitle: 'Document 1',
        documentPath: '/path/to/doc1',
        permission: 'Read',
        acePrincipal: 'test-group',
        begin: null,
        end: null,
        grantedBy: 'Administrator',
      },
    ],
    totalDocuments: 1,
    numberOfPages: 1,
    currentPageIndex: 0,
    currentPageSize: 10,
  };

  beforeEach(() => {
    paramMapSubject = new BehaviorSubject(convertToParamMap({ groupId: 'test-group' }));

    mockUserService = {
      getGroup: vi.fn().mockReturnValue(of(mockGroup)),
      updateGroup: vi.fn().mockReturnValue(of(mockGroup)),
      deleteGroup: vi.fn().mockReturnValue(of(undefined)),
    };

    mockPermService = {
      listLocalPermissionRows: vi.fn().mockReturnValue(of(mockLocalPerms)),
    };

    mockDocumentDetailService = {
      removePermission: vi.fn().mockReturnValue(of(undefined)),
    };

    TestBed.configureTestingModule({
      // The real English catalogue, not a `{ instant: key => key }` stub. `TranslatePipe` in this
      // template calls `translate.get()` and subscribes to the service's change streams, none of
      // which a hand-written stub has — and the assertions below then read the English a user
      // actually sees rather than the key a developer typed.
      imports: [AdminGroupDetailsPageComponent, testTranslateModule()],
      providers: [
        provideZonelessChangeDetection(),
        // The real router, not a stub: this template uses `routerLink`, and `RouterLink` reaches for
        // `createUrlTree` and `serializeUrl` as well as `navigate`. Stubbing Router means adding one
        // method per directive internal every time the template grows a link, and each omission
        // fails the test for an environment reason rather than a behavioural one.
        //
        // It must come *before* the `ActivatedRoute` override below: `provideRouter` supplies its
        // own `ActivatedRoute`, later providers win for the same token, and with the order reversed
        // the component read the router's empty param map instead of this one.
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: paramMapSubject.asObservable(),
          },
        },
        { provide: UserService, useValue: mockUserService },
        { provide: PrincipalPermissionsService, useValue: mockPermService },
        { provide: DocumentDetailService, useValue: mockDocumentDetailService },
        { provide: LOCALE_ID, useValue: 'en-US' },
      ],
    });

    fixture = TestBed.createComponent(AdminGroupDetailsPageComponent);
    component = fixture.componentInstance;

    // `MatDialog` and `MatSnackBar` cannot be replaced with root providers here. This component
    // imports `MatDialogModule` and `MatSnackBarModule`, and an NgModule imported by a standalone
    // component contributes its providers to that component's *node* injector — which shadows
    // anything TestBed provides at the root. A `{ provide: MatDialog, useValue: ... }` override is
    // therefore silently ignored: the component resolves the real service, and calling `open()` on
    // it crashes on internals a hand-written stub never had. Spying on the instance the component
    // actually resolved is what observes the call.
    mockRouter = {
      navigate: vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true),
    };

    const injector = fixture.debugElement.injector;
    mockDialog = {
      open: vi
        .spyOn(injector.get(MatDialog), 'open')
        .mockReturnValue({ afterClosed: () => of(undefined) } as never),
    };
    mockSnackBar = {
      open: vi
        .spyOn(injector.get(MatSnackBar), 'open')
        .mockReturnValue({ afterDismissed: () => of({}) } as never),
    };
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('ngOnInit', () => {
    it('should subscribe to route params and load group data', () => {
      const loadSpy = vi.spyOn(component, 'load');
      component.ngOnInit();

      expect(loadSpy).toHaveBeenCalled();
      expect(mockUserService.getGroup).toHaveBeenCalledWith('test-group');
    });

    it('should reset state when route params change', () => {
      component.ngOnInit();
      component.error.set('some error');
      component.localPageIndex.set(4);

      // The new group's request stays in flight, so what is asserted is the reset itself rather
      // than the state the replacement response happens to leave behind.
      mockUserService.getGroup.mockReturnValue(new Subject<NuxeoGroup>().asObservable());
      paramMapSubject.next(convertToParamMap({ groupId: 'another-group' }));

      expect(component.group()).toBeNull();
      expect(component.error()).toBeNull();
      expect(component.localPerm()).toBeNull();
      expect(component.localPageIndex()).toBe(0);
      expect(mockUserService.getGroup).toHaveBeenLastCalledWith('another-group');
    });
  });

  describe('load', () => {
    it('should show error when groupId is missing', () => {
      paramMapSubject.next(convertToParamMap({}));
      component.ngOnInit();

      expect(component.error()).toBe('Missing group id.');
      expect(mockUserService.getGroup).not.toHaveBeenCalled();
    });

    it('should load group data successfully', () => {
      component.ngOnInit();
      fixture.detectChanges();

      expect(component.loading()).toBe(false);
      expect(component.group()).toEqual(mockGroup);
      expect(component.error()).toBeNull();
    });

    it('should trigger loadLocalPerms after successful group load', () => {
      const loadLocalPermsSpy = vi.spyOn(component, 'loadLocalPerms');
      component.ngOnInit();
      fixture.detectChanges();

      expect(loadLocalPermsSpy).toHaveBeenCalled();
    });

    it('should handle group load error', () => {
      const errorResponse = { error: { message: 'Group not found' } };
      mockUserService.getGroup.mockReturnValue(throwError(() => errorResponse));

      component.ngOnInit();
      fixture.detectChanges();

      expect(component.error()).toBe('Group not found');
      expect(component.loading()).toBe(false);
    });

    it('should use fallback error message when error message is not provided', () => {
      mockUserService.getGroup.mockReturnValue(throwError(() => ({})));

      component.ngOnInit();
      fixture.detectChanges();

      expect(component.error()).toBe('Could not load group details.');
    });

    it('should set loading to true while fetching data and clear it on arrival', () => {
      component.ngOnInit();
      const pending = new Subject<NuxeoGroup>();
      mockUserService.getGroup.mockReturnValue(pending.asObservable());

      component.load();
      expect(component.loading()).toBe(true);

      pending.next(mockGroup);
      expect(component.loading()).toBe(false);
    });

    it('should reset localPageIndex to 0 on load', () => {
      component.localPageIndex.set(5);
      component.ngOnInit();
      fixture.detectChanges();

      expect(component.localPageIndex()).toBe(0);
    });
  });

  describe('openEdit', () => {
    beforeEach(() => {
      component.group.set(mockGroup);
    });

    it('should open edit dialog with correct data', () => {
      component.openEdit();

      expect(mockDialog.open).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          width: '480px',
          data: { mode: 'edit', group: mockGroup },
        }),
      );
    });

    it('should not open dialog when group is null', () => {
      component.group.set(null);
      component.openEdit();

      expect(mockDialog.open).not.toHaveBeenCalled();
    });

    it('should update group when dialog is confirmed', () => {
      const dialogResult = {
        mode: 'edit' as const,
        grouplabel: 'Updated Label',
        memberUsers: ['user1', 'user3'],
      };

      mockDialog.open.mockReturnValue({
        afterClosed: vi.fn().mockReturnValue(of(dialogResult)),
      } as never);

      component.openEdit();

      expect(mockUserService.updateGroup).toHaveBeenCalledWith('test-group', {
        grouplabel: 'Updated Label',
        memberUsers: ['user1', 'user3'],
      });
    });

    it('should show success message when update succeeds', () => {
      const dialogResult = {
        mode: 'edit' as const,
        grouplabel: 'Updated Label',
        memberUsers: ['user1'],
      };

      mockDialog.open.mockReturnValue({
        afterClosed: vi.fn().mockReturnValue(of(dialogResult)),
      } as never);

      component.openEdit();

      expect(mockSnackBar.open).toHaveBeenCalledWith('Group updated', 'Dismiss', {
        duration: 3000,
      });
    });

    it('should reload group data after successful update', () => {
      const loadSpy = vi.spyOn(component, 'load');
      const dialogResult = {
        mode: 'edit' as const,
        grouplabel: 'Updated Label',
        memberUsers: ['user1'],
      };

      mockDialog.open.mockReturnValue({
        afterClosed: vi.fn().mockReturnValue(of(dialogResult)),
      } as never);

      component.openEdit();

      expect(loadSpy).toHaveBeenCalled();
    });

    it('should not update when dialog is canceled', () => {
      mockDialog.open.mockReturnValue({
        afterClosed: vi.fn().mockReturnValue(of(undefined)),
      } as never);

      component.openEdit();

      expect(mockUserService.updateGroup).not.toHaveBeenCalled();
    });

    it('should handle update error and show error message', () => {
      const dialogResult = {
        mode: 'edit' as const,
        grouplabel: 'Updated Label',
        memberUsers: ['user1'],
      };
      const errorResponse = { error: { message: 'Update failed' } };

      mockDialog.open.mockReturnValue({
        afterClosed: vi.fn().mockReturnValue(of(dialogResult)),
      } as never);
      mockUserService.updateGroup.mockReturnValue(throwError(() => errorResponse));

      component.openEdit();

      expect(mockSnackBar.open).toHaveBeenCalledWith('Update failed', 'Dismiss', {
        duration: 5000,
      });
    });

    it('should use fallback error message when error message is not provided', () => {
      const dialogResult = {
        mode: 'edit' as const,
        grouplabel: 'Updated Label',
        memberUsers: ['user1'],
      };

      mockDialog.open.mockReturnValue({
        afterClosed: vi.fn().mockReturnValue(of(dialogResult)),
      } as never);
      mockUserService.updateGroup.mockReturnValue(throwError(() => ({})));

      component.openEdit();

      expect(mockSnackBar.open).toHaveBeenCalledWith('Update failed', 'Dismiss', {
        duration: 5000,
      });
    });
  });

  describe('confirmDelete', () => {
    beforeEach(() => {
      component.group.set(mockGroup);
    });

    it('should open confirmation dialog with correct data', () => {
      component.confirmDelete();

      expect(mockDialog.open).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          width: '400px',
          data: expect.objectContaining({
            title: 'Delete group',
            confirmLabel: 'Delete',
          }),
        }),
      );
    });

    it('should not open dialog when group is null', () => {
      component.group.set(null);
      component.confirmDelete();

      expect(mockDialog.open).not.toHaveBeenCalled();
    });

    it('should delete group when confirmed', () => {
      mockDialog.open.mockReturnValue({
        afterClosed: vi.fn().mockReturnValue(of(true)),
      } as never);

      component.confirmDelete();

      expect(mockUserService.deleteGroup).toHaveBeenCalledWith('test-group');
    });

    it('should navigate to users-groups list after successful delete', () => {
      mockDialog.open.mockReturnValue({
        afterClosed: vi.fn().mockReturnValue(of(true)),
      } as never);

      component.confirmDelete();

      expect(mockRouter.navigate).toHaveBeenCalledWith(['/administration/users-groups']);
    });

    it('should show success message after delete', () => {
      mockDialog.open.mockReturnValue({
        afterClosed: vi.fn().mockReturnValue(of(true)),
      } as never);

      component.confirmDelete();

      expect(mockSnackBar.open).toHaveBeenCalledWith('Group deleted', 'Dismiss', {
        duration: 3000,
      });
    });

    it('should not delete when dialog is canceled', () => {
      mockDialog.open.mockReturnValue({
        afterClosed: vi.fn().mockReturnValue(of(false)),
      } as never);

      component.confirmDelete();

      expect(mockUserService.deleteGroup).not.toHaveBeenCalled();
    });

    it('should handle delete error and show error message', () => {
      const errorResponse = { error: { message: 'Delete failed' } };
      mockDialog.open.mockReturnValue({
        afterClosed: vi.fn().mockReturnValue(of(true)),
      } as never);
      mockUserService.deleteGroup.mockReturnValue(throwError(() => errorResponse));

      component.confirmDelete();

      expect(mockSnackBar.open).toHaveBeenCalledWith('Delete failed', 'Dismiss', {
        duration: 5000,
      });
    });

    it('should use fallback error message when error message is not provided', () => {
      mockDialog.open.mockReturnValue({
        afterClosed: vi.fn().mockReturnValue(of(true)),
      } as never);
      mockUserService.deleteGroup.mockReturnValue(throwError(() => ({})));

      component.confirmDelete();

      expect(mockSnackBar.open).toHaveBeenCalledWith('Delete failed', 'Dismiss', {
        duration: 5000,
      });
    });
  });

  describe('removeMember', () => {
    beforeEach(() => {
      component.group.set(mockGroup);
    });

    it('should remove member from group successfully', () => {
      component.removeMember('user1');

      expect(mockUserService.updateGroup).toHaveBeenCalledWith('test-group', {
        memberUsers: ['user2'],
      });
    });

    it('should not call updateGroup when group is null', () => {
      component.group.set(null);
      component.removeMember('user1');

      expect(mockUserService.updateGroup).not.toHaveBeenCalled();
    });

    it('should show success message after removing member', () => {
      component.removeMember('user1');

      expect(mockSnackBar.open).toHaveBeenCalledWith('Member removed', 'Dismiss', {
        duration: 2500,
      });
    });

    it('should reload group data after removing member', () => {
      const loadSpy = vi.spyOn(component, 'load');
      component.removeMember('user1');

      expect(loadSpy).toHaveBeenCalled();
    });

    it('should handle remove member error', () => {
      const errorResponse = { error: { message: 'Remove failed' } };
      mockUserService.updateGroup.mockReturnValue(throwError(() => errorResponse));

      component.removeMember('user1');

      expect(mockSnackBar.open).toHaveBeenCalledWith('Remove failed', 'Dismiss', {
        duration: 5000,
      });
    });

    it('should use fallback error message when error message is not provided', () => {
      mockUserService.updateGroup.mockReturnValue(throwError(() => ({})));

      component.removeMember('user1');

      expect(mockSnackBar.open).toHaveBeenCalledWith('Could not remove member', 'Dismiss', {
        duration: 5000,
      });
    });

    it('should handle empty memberUsers array', () => {
      const groupWithoutMembers = { ...mockGroup, memberUsers: [] };
      component.group.set(groupWithoutMembers);

      component.removeMember('user1');

      expect(mockUserService.updateGroup).toHaveBeenCalledWith('test-group', {
        memberUsers: [],
      });
    });
  });

  describe('loadLocalPerms', () => {
    it('should load local permissions successfully', () => {
      component.ngOnInit();
      fixture.detectChanges();

      expect(mockPermService.listLocalPermissionRows).toHaveBeenCalledWith('test-group', 10, 0);
      expect(component.localPerm()).toEqual(mockLocalPerms);
      expect(component.localPermLoading()).toBe(false);
    });

    it('should set loading to true while fetching permissions and clear it on arrival', () => {
      // A `Subject` that has not emitted yet, so the in-flight state is observable at all. With an
      // `of(...)` or a `BehaviorSubject` the response lands during `subscribe()` and the flag is
      // already back to false by the time the assertion runs.
      const pending = new Subject<PrincipalPermissionPage>();
      mockPermService.listLocalPermissionRows.mockReturnValue(pending.asObservable());

      component.loadLocalPerms();
      expect(component.localPermLoading()).toBe(true);

      pending.next(mockLocalPerms);
      expect(component.localPermLoading()).toBe(false);
      expect(component.localPerm()).toEqual(mockLocalPerms);
    });

    it('should handle permission load error gracefully', () => {
      mockPermService.listLocalPermissionRows.mockReturnValue(
        throwError(() => new Error('Load failed')),
      );

      component.loadLocalPerms();

      expect(component.localPerm()).toEqual({
        rows: [],
        totalDocuments: 0,
        numberOfPages: 0,
        currentPageIndex: 0,
        currentPageSize: 0,
      });
      expect(component.localPermLoading()).toBe(false);
    });

    it('should use current pageIndex when loading permissions', () => {
      // `ngOnInit` is what puts the group id in place; without it the component would ask for ''.
      component.ngOnInit();
      mockPermService.listLocalPermissionRows.mockClear();
      component.localPageIndex.set(2);

      component.loadLocalPerms();

      expect(mockPermService.listLocalPermissionRows).toHaveBeenCalledWith('test-group', 10, 2);
    });

    it('should reload the page the paginator moved to', () => {
      component.ngOnInit();
      mockPermService.listLocalPermissionRows.mockClear();

      component.onLocalPermPage({ pageIndex: 3, pageSize: 10, length: 40 } as PageEvent);

      expect(component.localPageIndex()).toBe(3);
      expect(mockPermService.listLocalPermissionRows).toHaveBeenCalledWith('test-group', 10, 3);
    });
  });

  describe('onLocalPermPage', () => {
    it('should update page index and reload permissions', () => {
      const loadLocalPermsSpy = vi.spyOn(component, 'loadLocalPerms');
      const pageEvent: PageEvent = {
        pageIndex: 2,
        pageSize: 10,
        length: 100,
      };

      component.onLocalPermPage(pageEvent);

      expect(component.localPageIndex()).toBe(2);
      expect(loadLocalPermsSpy).toHaveBeenCalled();
    });
  });

  describe('removePermission', () => {
    const mockPermRow: PrincipalPermissionRow = {
      documentUid: 'doc-1',
      documentTitle: 'Document 1',
      documentPath: '/path/to/doc1',
      permission: 'Read',
      acePrincipal: 'test-group',
      begin: null,
      end: null,
      grantedBy: 'Administrator',
    };

    it('should remove permission successfully', () => {
      component.removePermission(mockPermRow);

      expect(mockDocumentDetailService.removePermission).toHaveBeenCalledWith('doc-1', {
        user: 'test-group',
        permission: 'Read',
        acl: 'local',
      });
    });

    it('should show success message after removing permission', () => {
      component.removePermission(mockPermRow);

      expect(mockSnackBar.open).toHaveBeenCalledWith('Permission removed', 'Dismiss', {
        duration: 2500,
      });
    });

    it('should reload permissions after removing permission', () => {
      const loadLocalPermsSpy = vi.spyOn(component, 'loadLocalPerms');
      component.removePermission(mockPermRow);

      expect(loadLocalPermsSpy).toHaveBeenCalled();
    });

    it('should handle remove permission error', () => {
      const errorResponse = { error: { message: 'Permission removal failed' } };
      mockDocumentDetailService.removePermission.mockReturnValue(throwError(() => errorResponse));

      component.removePermission(mockPermRow);

      expect(mockSnackBar.open).toHaveBeenCalledWith('Permission removal failed', 'Dismiss', {
        duration: 5000,
      });
    });

    it('should use fallback error message when error message is not provided', () => {
      mockDocumentDetailService.removePermission.mockReturnValue(throwError(() => ({})));

      component.removePermission(mockPermRow);

      expect(mockSnackBar.open).toHaveBeenCalledWith('Could not remove permission', 'Dismiss', {
        duration: 5000,
      });
    });
  });

  describe('timeFrameLabel', () => {
    const baseRow: PrincipalPermissionRow = {
      documentUid: 'doc-1',
      documentTitle: 'Document 1',
      documentPath: '/path/to/doc1',
      permission: 'Read',
      acePrincipal: 'test-group',
      begin: null,
      end: null,
      grantedBy: 'Administrator',
    };

    /**
     * The same rendering the component performs: the app's locale, not the host's, and UTC.
     *
     * An argument-less `toLocaleString()` here reads the *host* locale, which is the exact defect
     * `fix(i18n): format dates in the user's locale, not the host's` removed from the formatter —
     * so these assertions passed only on a machine whose locale happened to be en-US.
     */
    function asRendered(iso: string): string {
      return new Date(iso).toLocaleString('en-US', { timeZone: 'UTC' });
    }

    it('should render a bounded permission as a translated date range', () => {
      const label = component.timeFrameLabel({
        ...baseRow,
        begin: '2026-01-01T00:00:00.000Z',
        end: '2026-12-31T00:00:00.000Z',
      } as PrincipalPermissionRow);

      expect(label).toBe(
        `${asRendered('2026-01-01T00:00:00.000Z')} – ${asRendered('2026-12-31T00:00:00.000Z')}`,
      );
    });

    it('should render an em dash for the open end of a half-bounded permission', () => {
      const label = component.timeFrameLabel({
        ...baseRow,
        begin: '2026-01-01T00:00:00.000Z',
        end: null,
      } as PrincipalPermissionRow);

      expect(label).toBe(`${asRendered('2026-01-01T00:00:00.000Z')} – —`);
    });

    it('should call an unbounded permission Permanent', () => {
      // The translated English from the real catalogue, not the key: this is what a user reads.
      expect(component.timeFrameLabel(baseRow)).toBe('Permanent');
    });
  });

  describe('removeNestedGroup', () => {
    beforeEach(() => {
      component.group.set(mockGroup);
    });

    it('should remove nested group successfully', () => {
      component.removeNestedGroup('nested-group1');

      expect(mockUserService.updateGroup).toHaveBeenCalledWith('test-group', {
        memberGroups: [],
      });
    });

    it('should not call updateGroup when group is null', () => {
      component.group.set(null);
      component.removeNestedGroup('nested-group1');

      expect(mockUserService.updateGroup).not.toHaveBeenCalled();
    });

    it('should show success message after removing nested group', () => {
      component.removeNestedGroup('nested-group1');

      expect(mockSnackBar.open).toHaveBeenCalledWith('Nested group removed', 'Dismiss', {
        duration: 2500,
      });
    });

    it('should reload group data after removing nested group', () => {
      const loadSpy = vi.spyOn(component, 'load');
      component.removeNestedGroup('nested-group1');

      expect(loadSpy).toHaveBeenCalled();
    });

    it('should handle remove nested group error', () => {
      const errorResponse = { error: { message: 'Remove failed' } };
      mockUserService.updateGroup.mockReturnValue(throwError(() => errorResponse));

      component.removeNestedGroup('nested-group1');

      expect(mockSnackBar.open).toHaveBeenCalledWith('Remove failed', 'Dismiss', {
        duration: 5000,
      });
    });

    it('should use fallback error message when error message is not provided', () => {
      mockUserService.updateGroup.mockReturnValue(throwError(() => ({})));

      component.removeNestedGroup('nested-group1');

      expect(mockSnackBar.open).toHaveBeenCalledWith('Could not update nested groups', 'Dismiss', {
        duration: 5000,
      });
    });

    it('should handle empty memberGroups array', () => {
      const groupWithoutNested = { ...mockGroup, memberGroups: [] };
      component.group.set(groupWithoutNested);

      component.removeNestedGroup('nested-group1');

      expect(mockUserService.updateGroup).toHaveBeenCalledWith('test-group', {
        memberGroups: [],
      });
    });
  });

  describe('resetState', () => {
    it('should reset all signals to initial state', () => {
      component.group.set(mockGroup);
      component.loading.set(true);
      component.error.set('some error');
      component.localPerm.set(mockLocalPerms);
      component.localPermLoading.set(true);
      component.localPageIndex.set(5);

      component['resetState']();

      expect(component.group()).toBeNull();
      expect(component.loading()).toBe(false);
      expect(component.error()).toBeNull();
      expect(component.localPerm()).toBeNull();
      expect(component.localPermLoading()).toBe(false);
      expect(component.localPageIndex()).toBe(0);
    });
  });

  describe('column definitions', () => {
    it('should have correct user columns', () => {
      expect(component.userColumns).toEqual(['username', 'actions']);
    });

    it('should have correct nested group columns', () => {
      expect(component.nestedColumns).toEqual(['groupname', 'actions']);
    });

    it('should have correct permission columns', () => {
      expect(component.permColumns).toEqual(['on', 'right', 'timeFrame', 'grantedBy', 'actions']);
    });

    it('should have correct permission page size', () => {
      expect(component.permPageSize).toBe(10);
    });
  });

  describe('signal properties', () => {
    it('should initialize group signal as null', () => {
      expect(component.group()).toBeNull();
    });

    it('should initialize loading signal as false', () => {
      expect(component.loading()).toBe(false);
    });

    it('should initialize error signal as null', () => {
      expect(component.error()).toBeNull();
    });

    it('should initialize localPerm signal as null', () => {
      expect(component.localPerm()).toBeNull();
    });

    it('should initialize localPermLoading signal as false', () => {
      expect(component.localPermLoading()).toBe(false);
    });

    it('should initialize localPageIndex signal as 0', () => {
      expect(component.localPageIndex()).toBe(0);
    });
  });
});
