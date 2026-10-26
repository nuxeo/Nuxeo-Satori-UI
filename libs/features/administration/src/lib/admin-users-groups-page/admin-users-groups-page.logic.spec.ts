import { TranslateService } from '@ngx-translate/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, LOCALE_ID } from '@angular/core';
import { Router, provideRouter } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatMenuTrigger } from '@angular/material/menu';
import { PageEvent } from '@angular/material/paginator';
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { Subject, of, throwError } from 'rxjs';

import {
  UserService,
  type NuxeoDocument,
  type NuxeoGroup,
  type NuxeoGroupList,
  type NuxeoUser,
  type NuxeoUserList,
} from '@nuxeo/satori-platform/nuxeo-client';
import { testTranslateModule } from '@agentic-ui/testing/i18n';

import { AdminUsersGroupsPageComponent } from './admin-users-groups-page.component';

/**
 * The component's own behaviour: searching, paging, the dialog flows and the display helpers.
 *
 * Separate from `admin-users-groups-page.component.spec.ts`, which renders the real template to pin
 * the NXSAT-166/171 DOM regressions. They cannot share a file: those tests use `fakeAsync`, which
 * needs zone.js's ProxyZone, and this suite installs Vitest fake timers to drive the post-mutation
 * refresh delay and the members-menu hover timer. The two clock mechanisms are mutually exclusive —
 * merged into one file, the `fakeAsync` tests fail with "Expected to be running in 'ProxyZone'".
 */
describe('AdminUsersGroupsPageComponent', () => {
  let component: AdminUsersGroupsPageComponent;
  let fixture: ComponentFixture<AdminUsersGroupsPageComponent>;
  let userService: {
    searchUsersPaged: ReturnType<typeof vi.fn>;
    searchGroupsPaged: ReturnType<typeof vi.fn>;
    getRecentlyCreatedUsersAndGroups: ReturnType<typeof vi.fn>;
    getUser: ReturnType<typeof vi.fn>;
    updateUser: ReturnType<typeof vi.fn>;
    deleteUser: ReturnType<typeof vi.fn>;
    createGroup: ReturnType<typeof vi.fn>;
    updateGroup: ReturnType<typeof vi.fn>;
    deleteGroup: ReturnType<typeof vi.fn>;
  };
  let dialogOpen: MockInstance<MatDialog['open']>;
  let snackBarOpen: MockInstance<MatSnackBar['open']>;
  let navigate: MockInstance<Router['navigate']>;

  const mockUser = {
    id: 'jdoe',
    properties: {
      username: 'jdoe',
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      groups: ['members', 'reviewers'],
    },
  } as unknown as NuxeoUser;

  const mockGroup = {
    groupname: 'reviewers',
    grouplabel: 'Reviewers',
    memberUsers: ['jdoe', 'asmith'],
    memberGroups: [],
  } as unknown as NuxeoGroup;

  const usersList = {
    'entity-type': 'users',
    entries: [mockUser],
    totalSize: 1,
  } as unknown as NuxeoUserList;

  const groupsList = {
    'entity-type': 'groups',
    entries: [mockGroup],
    totalSize: 1,
  } as unknown as NuxeoGroupList;

  const recentUserDoc = {
    uid: 'jdoe',
    type: 'user',
    title: 'jdoe',
    properties: {
      'user:firstName': 'Jane',
      'user:lastName': 'Doe',
      'user:email': 'jane@example.com',
    },
  } as unknown as NuxeoDocument;

  const recentGroupDoc = {
    uid: 'reviewers',
    type: 'group',
    title: 'reviewers',
    properties: { 'group:grouplabel': 'Reviewers' },
  } as unknown as NuxeoDocument;

  beforeEach(() => {
    vi.useFakeTimers();

    userService = {
      searchUsersPaged: vi.fn().mockReturnValue(of(usersList)),
      searchGroupsPaged: vi.fn().mockReturnValue(of(groupsList)),
      getRecentlyCreatedUsersAndGroups: vi
        .fn()
        .mockReturnValue(of({ entries: [recentUserDoc, recentGroupDoc] })),
      getUser: vi.fn().mockReturnValue(of(mockUser)),
      updateUser: vi.fn().mockReturnValue(of(mockUser)),
      deleteUser: vi.fn().mockReturnValue(of(undefined)),
      createGroup: vi.fn().mockReturnValue(of(mockGroup)),
      updateGroup: vi.fn().mockReturnValue(of(mockGroup)),
      deleteGroup: vi.fn().mockReturnValue(of(undefined)),
    };

    TestBed.configureTestingModule({
      // The real English catalogue: `TranslatePipe` in this template calls `translate.get()` and
      // subscribes to the service's change streams, which a `{ instant: key => key }` stub lacks.
      // The assertions below therefore read the English a user sees rather than the key.
      imports: [AdminUsersGroupsPageComponent, testTranslateModule()],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: UserService, useValue: userService },
        { provide: LOCALE_ID, useValue: 'en-US' },
      ],
    });

    fixture = TestBed.createComponent(AdminUsersGroupsPageComponent);
    component = fixture.componentInstance;

    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    // `MatDialog` and `MatSnackBar` cannot be replaced with root providers: this component imports
    // `MatDialogModule` and `MatSnackBarModule`, and an NgModule imported by a standalone component
    // contributes its providers to that component's *node* injector, which shadows the TestBed root.
    // A `{ provide: MatDialog, useValue: ... }` override is silently ignored — the component gets
    // the real service and `open()` then crashes on internals a stub never had.
    const injector = fixture.debugElement.injector;
    dialogOpen = vi
      .spyOn(injector.get(MatDialog), 'open')
      .mockReturnValue({ afterClosed: () => of(undefined) } as never);
    snackBarOpen = vi
      .spyOn(injector.get(MatSnackBar), 'open')
      .mockReturnValue({ afterDismissed: () => of({}) } as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Makes the next dialog close with `result`. */
  function dialogReturns(result: unknown): void {
    dialogOpen.mockReturnValue({ afterClosed: () => of(result) } as never);
  }

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('ngOnInit', () => {
    it('should run the initial search and load the recent list', () => {
      component.ngOnInit();

      expect(userService.searchUsersPaged).toHaveBeenCalledWith('', 20, 0);
      expect(userService.searchGroupsPaged).toHaveBeenCalledWith('', 20, 0);
      expect(userService.getRecentlyCreatedUsersAndGroups).toHaveBeenCalledWith(50, 0);
    });
  });

  describe('runSearch', () => {
    it('should load both tables and their totals', () => {
      component.runSearch();

      expect(component.users()).toEqual([mockUser]);
      expect(component.usersTotal()).toBe(1);
      expect(component.groups()).toEqual([mockGroup]);
      expect(component.groupsTotal()).toBe(1);
      expect(component.usersLoading()).toBe(false);
      expect(component.groupsLoading()).toBe(false);
    });

    it('should reset both paginators to the first page', () => {
      component.usersPageIndex.set(3);
      component.groupsPageIndex.set(2);

      component.runSearch();

      expect(component.usersPageIndex()).toBe(0);
      expect(component.groupsPageIndex()).toBe(0);
    });

    it('should pass the search query to both searches', () => {
      component.combinedSearchQuery = 'jdoe';

      component.runSearch();

      expect(userService.searchUsersPaged).toHaveBeenCalledWith('jdoe', 20, 0);
      expect(userService.searchGroupsPaged).toHaveBeenCalledWith('jdoe', 20, 0);
    });

    it('should show both tables loading until the joined request lands', () => {
      const users = new Subject<NuxeoUserList>();
      const groups = new Subject<NuxeoGroupList>();
      userService.searchUsersPaged.mockReturnValue(users.asObservable());
      userService.searchGroupsPaged.mockReturnValue(groups.asObservable());

      component.runSearch();
      expect(component.usersLoading()).toBe(true);
      expect(component.groupsLoading()).toBe(true);

      // `forkJoin` waits for both to complete, so neither table clears on the first response.
      users.next(usersList);
      users.complete();
      expect(component.usersLoading()).toBe(true);

      groups.next(groupsList);
      groups.complete();
      expect(component.usersLoading()).toBe(false);
      expect(component.groupsLoading()).toBe(false);
    });

    it('should keep the groups table when the users search fails', () => {
      userService.searchUsersPaged.mockReturnValue(throwError(() => new Error('Users are down')));

      component.runSearch();

      // The per-branch `catchError` is what makes this possible: without it `forkJoin` would
      // abandon the groups request too and both tables would be empty.
      expect(component.usersError()).toBe('Users are down');
      expect(component.users()).toEqual([]);
      expect(component.usersTotal()).toBe(0);
      expect(component.groups()).toEqual([mockGroup]);
      expect(component.groupsLoading()).toBe(false);
    });

    it('should keep the users table when the groups search fails', () => {
      userService.searchGroupsPaged.mockReturnValue(throwError(() => new Error('Groups are down')));

      component.runSearch();

      expect(component.groupsError()).toBe('Groups are down');
      expect(component.groups()).toEqual([]);
      expect(component.users()).toEqual([mockUser]);
    });

    it('should fall back to a generic message when a failure carries none', () => {
      userService.searchUsersPaged.mockReturnValue(throwError(() => ({})));
      userService.searchGroupsPaged.mockReturnValue(throwError(() => ({})));

      component.runSearch();

      expect(component.usersError()).toBe('Could not load users.');
      expect(component.groupsError()).toBe('Could not load groups.');
    });

    it('should clear stale errors from a previous search', () => {
      component.usersError.set('old users error');
      component.groupsError.set('old groups error');

      component.runSearch();

      expect(component.usersError()).toBeNull();
      expect(component.groupsError()).toBeNull();
    });

    it('should treat responses with no entries as empty tables', () => {
      userService.searchUsersPaged.mockReturnValue(of({ 'entity-type': 'users', totalSize: 0 }));
      userService.searchGroupsPaged.mockReturnValue(of({ 'entity-type': 'groups', totalSize: 0 }));

      component.runSearch();

      expect(component.users()).toEqual([]);
      expect(component.groups()).toEqual([]);
    });
  });

  describe('tab selection after a search', () => {
    it('should stay on the Users tab for an empty query', () => {
      component.selectedTabIndex.set(1);
      component.combinedSearchQuery = '';

      component.runSearch();

      // No query means no opinion about which tab to show — leave whatever the user picked.
      expect(component.selectedTabIndex()).toBe(1);
    });

    it('should switch to the Groups tab when only groups match', () => {
      component.combinedSearchQuery = 'reviewers';
      userService.searchUsersPaged.mockReturnValue(
        of({ 'entity-type': 'users', entries: [], totalSize: 0 }),
      );

      component.runSearch();

      expect(component.selectedTabIndex()).toBe(1);
    });

    it('should switch to the Users tab when users match', () => {
      component.selectedTabIndex.set(1);
      component.combinedSearchQuery = 'jdoe';

      component.runSearch();

      expect(component.selectedTabIndex()).toBe(0);
    });

    it('should leave the tab alone when neither side matches', () => {
      component.selectedTabIndex.set(1);
      component.combinedSearchQuery = 'nothing-matches-this';
      userService.searchUsersPaged.mockReturnValue(
        of({ 'entity-type': 'users', entries: [], totalSize: 0 }),
      );
      userService.searchGroupsPaged.mockReturnValue(
        of({ 'entity-type': 'groups', entries: [], totalSize: 0 }),
      );

      component.runSearch();

      expect(component.selectedTabIndex()).toBe(1);
    });

    it('should label each tab with its total', () => {
      component.runSearch();

      expect(component.usersTabLabel()).toBe('Users (1)');
      expect(component.groupsTabLabel()).toBe('Groups (1)');
    });

    it('relabels the tabs when the language changes, without a new search', () => {
      component.runSearch();
      expect(component.usersTabLabel()).toBe('Users (1)');

      const translate = TestBed.inject(TranslateService);
      translate.setTranslation('fr', {
        admin: { 'admin-users-groups-page': { 'users-tab': 'Utilisateurs ({{ count }})' } },
      });
      translate.use('fr');

      expect(component.usersTabLabel()).toBe('Utilisateurs (1)');
    });
  });

  describe('loadUsers', () => {
    it('should load the current page and its total', () => {
      component.usersPageIndex.set(2);

      component.loadUsers();

      expect(userService.searchUsersPaged).toHaveBeenCalledWith('', 20, 2);
      expect(component.users()).toEqual([mockUser]);
      expect(component.usersLoading()).toBe(false);
    });

    it('should show loading until the page arrives', () => {
      const pending = new Subject<NuxeoUserList>();
      userService.searchUsersPaged.mockReturnValue(pending.asObservable());

      component.loadUsers();
      expect(component.usersLoading()).toBe(true);

      pending.next(usersList);
      expect(component.usersLoading()).toBe(false);
    });

    it("should surface the failure's message and stop loading", () => {
      userService.searchUsersPaged.mockReturnValue(throwError(() => new Error('Users are down')));

      component.loadUsers();

      expect(component.usersError()).toBe('Users are down');
      expect(component.usersLoading()).toBe(false);
    });

    it('should fall back to a generic message when the failure carries none', () => {
      userService.searchUsersPaged.mockReturnValue(throwError(() => ({})));

      component.loadUsers();

      expect(component.usersError()).toBe('Could not load users.');
    });
  });

  describe('loadGroups', () => {
    it('should load the current page and its total', () => {
      component.groupsPageIndex.set(1);

      component.loadGroups();

      expect(userService.searchGroupsPaged).toHaveBeenCalledWith('', 20, 1);
      expect(component.groups()).toEqual([mockGroup]);
      expect(component.groupsLoading()).toBe(false);
    });

    it("should surface the failure's message and stop loading", () => {
      userService.searchGroupsPaged.mockReturnValue(throwError(() => new Error('Groups are down')));

      component.loadGroups();

      expect(component.groupsError()).toBe('Groups are down');
      expect(component.groupsLoading()).toBe(false);
    });

    it('should fall back to a generic message when the failure carries none', () => {
      userService.searchGroupsPaged.mockReturnValue(throwError(() => ({})));

      component.loadGroups();

      expect(component.groupsError()).toBe('Could not load groups.');
    });
  });

  describe('paging', () => {
    it('should load the users page the paginator moved to', () => {
      userService.searchUsersPaged.mockClear();

      component.onUsersPage({ pageIndex: 2, pageSize: 20, length: 60 } as PageEvent);

      expect(component.usersPageIndex()).toBe(2);
      expect(userService.searchUsersPaged).toHaveBeenCalledWith('', 20, 2);
    });

    it('should not refetch users when the paginator reports the page already shown', () => {
      component.usersPageIndex.set(2);
      userService.searchUsersPaged.mockClear();

      component.onUsersPage({ pageIndex: 2, pageSize: 20, length: 60 } as PageEvent);

      // `MatPaginator` emits on page-size changes too; refetching the same page would double the
      // requests for no new data.
      expect(userService.searchUsersPaged).not.toHaveBeenCalled();
    });

    it('should load the groups page the paginator moved to', () => {
      userService.searchGroupsPaged.mockClear();

      component.onGroupsPage({ pageIndex: 1, pageSize: 20, length: 40 } as PageEvent);

      expect(component.groupsPageIndex()).toBe(1);
      expect(userService.searchGroupsPaged).toHaveBeenCalledWith('', 20, 1);
    });

    it('should not refetch groups when the paginator reports the page already shown', () => {
      component.groupsPageIndex.set(1);
      userService.searchGroupsPaged.mockClear();

      component.onGroupsPage({ pageIndex: 1, pageSize: 20, length: 40 } as PageEvent);

      expect(userService.searchGroupsPaged).not.toHaveBeenCalled();
    });

    it('should page the recent table client-side without refetching', () => {
      userService.getRecentlyCreatedUsersAndGroups.mockClear();

      component.onRecentPage({ pageIndex: 1, pageSize: 5, length: 10 } as PageEvent);

      expect(component.recentPageIndex()).toBe(1);
      expect(userService.getRecentlyCreatedUsersAndGroups).not.toHaveBeenCalled();
    });

    it('should ignore a recent-table page event for the page already shown', () => {
      component.onRecentPage({ pageIndex: 0, pageSize: 5, length: 10 } as PageEvent);
      expect(component.recentPageIndex()).toBe(0);
    });
  });

  describe('recently created list', () => {
    it('should map a user document to a row with its joined name and email', () => {
      component.loadRecent();

      expect(component.recentRows()[0]).toEqual({
        kind: 'user',
        name: 'Jane Doe',
        identifier: 'jdoe',
        email: 'jane@example.com',
      });
      expect(component.recentLoading()).toBe(false);
    });

    it('should map a group document to a row with its label and no email', () => {
      component.loadRecent();

      expect(component.recentRows()[1]).toEqual({
        kind: 'group',
        name: 'Reviewers',
        identifier: 'reviewers',
        email: '',
      });
    });

    it('should fall back to the uid when a user has no name', () => {
      userService.getRecentlyCreatedUsersAndGroups.mockReturnValue(
        of({ entries: [{ uid: 'asmith', type: 'user', properties: {} }] }),
      );

      component.loadRecent();

      expect(component.recentRows()[0]).toEqual({
        kind: 'user',
        name: 'asmith',
        identifier: 'asmith',
        email: '',
      });
    });

    it('should fall back to the uid when a group has no label', () => {
      userService.getRecentlyCreatedUsersAndGroups.mockReturnValue(
        of({ entries: [{ uid: 'qa', type: 'group', properties: {} }] }),
      );

      component.loadRecent();

      expect(component.recentRows()[0].name).toBe('qa');
    });

    it('should drop documents that are neither a user nor a group', () => {
      userService.getRecentlyCreatedUsersAndGroups.mockReturnValue(
        of({ entries: [{ uid: 'f1', type: 'File', properties: {} }, recentUserDoc] }),
      );

      component.loadRecent();

      expect(component.recentRows()).toHaveLength(1);
      expect(component.recentRows()[0].identifier).toBe('jdoe');
    });

    it('should show only one page of rows at a time', () => {
      const many = Array.from({ length: 7 }, (_, i) => ({
        uid: `user${i}`,
        type: 'user',
        properties: { 'user:firstName': `User${i}`, 'user:lastName': '' },
      }));
      userService.getRecentlyCreatedUsersAndGroups.mockReturnValue(of({ entries: many }));

      component.loadRecent();

      expect(component.recentRows()).toHaveLength(7);
      expect(component.recentRowsPage()).toHaveLength(5);
      expect(component.recentRowsPage()[0].identifier).toBe('user0');

      component.onRecentPage({ pageIndex: 1, pageSize: 5, length: 7 } as PageEvent);

      expect(component.recentRowsPage()).toHaveLength(2);
      expect(component.recentRowsPage()[0].identifier).toBe('user5');
    });

    it('should reset to the first page whenever the list reloads', () => {
      component.recentPageIndex.set(1);

      component.loadRecent();

      expect(component.recentPageIndex()).toBe(0);
    });

    it('should clear the rows when the request fails', () => {
      component.loadRecent();
      expect(component.recentRows()).not.toEqual([]);
      userService.getRecentlyCreatedUsersAndGroups.mockReturnValue(
        throwError(() => new Error('500')),
      );

      component.loadRecent();

      expect(component.recentRows()).toEqual([]);
      expect(component.recentPageIndex()).toBe(0);
      expect(component.recentLoading()).toBe(false);
    });

    it('should treat a response with no entries as an empty list', () => {
      userService.getRecentlyCreatedUsersAndGroups.mockReturnValue(of({}));

      component.loadRecent();

      expect(component.recentRows()).toEqual([]);
    });
  });

  describe('navigation', () => {
    it('should open a user from the users table', () => {
      component.selectUser(mockUser);
      expect(navigate).toHaveBeenCalledWith(['/administration/users-groups/user', 'jdoe']);
    });

    it('should open a group from the groups table', () => {
      component.selectGroup(mockGroup);
      expect(navigate).toHaveBeenCalledWith(['/administration/users-groups/group', 'reviewers']);
    });

    it('should open a user row from the recent table', () => {
      component.openRecentRow({
        kind: 'user',
        name: 'Jane Doe',
        identifier: 'jdoe',
        email: 'jane@example.com',
      });

      expect(navigate).toHaveBeenCalledWith(['/administration/users-groups/user', 'jdoe']);
    });

    it('should open a group row from the recent table', () => {
      component.openRecentRow({
        kind: 'group',
        name: 'Reviewers',
        identifier: 'reviewers',
        email: '',
      });

      expect(navigate).toHaveBeenCalledWith(['/administration/users-groups/group', 'reviewers']);
    });
  });

  describe('openCreateUser', () => {
    it('should open the dialog in create mode', () => {
      component.openCreateUser();

      expect(dialogOpen).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ data: { mode: 'create' } }),
      );
    });

    it('should do nothing when the dialog is cancelled', () => {
      dialogReturns(undefined);

      component.openCreateUser();

      expect(userService.getUser).not.toHaveBeenCalled();
      expect(snackBarOpen).not.toHaveBeenCalled();
    });

    it('should ignore a result from a different mode', () => {
      dialogReturns({ mode: 'edit', username: 'jdoe' });

      component.openCreateUser();

      expect(snackBarOpen).not.toHaveBeenCalled();
    });

    it('should fetch the new user, show it at the top of the table, and confirm', () => {
      component.users.set([]);
      dialogReturns({ mode: 'create', username: 'jdoe', email: 'jane@example.com' });

      component.openCreateUser();

      expect(userService.getUser).toHaveBeenCalledWith('jdoe');
      expect(component.users()).toEqual([mockUser]);
      expect(snackBarOpen).toHaveBeenCalledWith('User created', 'Dismiss', { duration: 3000 });
      // The search box is narrowed to the new user so the refreshed table shows them.
      expect(component.combinedSearchQuery).toBe('jdoe');
    });

    it('should not duplicate a user the table already shows', () => {
      component.users.set([mockUser]);
      dialogReturns({ mode: 'create', username: 'jdoe', email: 'jane@example.com' });

      component.openCreateUser();

      expect(component.users()).toEqual([mockUser]);
    });

    it('should still confirm when the new user cannot be fetched back', () => {
      userService.getUser.mockReturnValue(throwError(() => new Error('404')));
      // The refresh that follows repopulates the table, so it has to come back empty for the
      // absence of an optimistically prepended row to be observable at all.
      userService.searchUsersPaged.mockReturnValue(
        of({ 'entity-type': 'users', entries: [], totalSize: 0 }),
      );
      component.users.set([]);
      dialogReturns({ mode: 'create', username: 'jdoe', email: 'jane@example.com' });

      component.openCreateUser();

      // Created is created: a failed read-back must not look like a failed create.
      expect(component.users()).toEqual([]);
      expect(snackBarOpen).toHaveBeenCalledWith('User created', 'Dismiss', { duration: 3000 });
    });

    it('should report an invitation instead of fetching a user that does not exist yet', () => {
      dialogReturns({
        mode: 'create',
        username: 'newbie',
        email: 'newbie@example.com',
        invited: true,
      });

      component.openCreateUser();

      expect(userService.getUser).not.toHaveBeenCalled();
      expect(snackBarOpen).toHaveBeenCalledWith(
        'Invitation sent to newbie@example.com. The user will appear after they accept.',
        'Dismiss',
        { duration: 6000 },
      );
      // An invited user has no account yet, so narrowing the search to them would show nothing.
      expect(component.combinedSearchQuery).toBe('');
    });

    it('should reopen the dialog when the user asked to create another', () => {
      dialogOpen
        .mockReturnValueOnce({
          afterClosed: () =>
            of({ mode: 'create', username: 'jdoe', email: 'j@e.com', createAnother: true }),
        } as never)
        .mockReturnValueOnce({ afterClosed: () => of(undefined) } as never);

      component.openCreateUser();

      expect(dialogOpen).toHaveBeenCalledTimes(2);
    });

    it('should not reopen the dialog otherwise', () => {
      dialogReturns({ mode: 'create', username: 'jdoe', email: 'j@e.com' });

      component.openCreateUser();

      expect(dialogOpen).toHaveBeenCalledTimes(1);
    });
  });

  describe('openEditUser', () => {
    it('should open the dialog in edit mode with the user', () => {
      component.openEditUser(mockUser);

      expect(dialogOpen).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ data: { mode: 'edit', user: mockUser } }),
      );
    });

    it('should do nothing when the dialog is cancelled', () => {
      dialogReturns(undefined);

      component.openEditUser(mockUser);

      expect(userService.updateUser).not.toHaveBeenCalled();
    });

    it('should ignore a result from a different mode', () => {
      dialogReturns({ mode: 'create', username: 'someone' });

      component.openEditUser(mockUser);

      expect(userService.updateUser).not.toHaveBeenCalled();
    });

    it('should send every edited field and confirm', () => {
      dialogReturns({
        mode: 'edit',
        firstName: 'Janet',
        lastName: 'Doe',
        company: 'Globex',
        email: 'janet@example.com',
        password: '',
        groups: ['members'],
      });

      component.openEditUser(mockUser);

      expect(userService.updateUser).toHaveBeenCalledWith('jdoe', {
        firstName: 'Janet',
        lastName: 'Doe',
        company: 'Globex',
        email: 'janet@example.com',
        password: '',
        groups: ['members'],
      });
      expect(snackBarOpen).toHaveBeenCalledWith('User updated', 'Dismiss', { duration: 3000 });
    });

    it("should surface the server's message when the edit fails", () => {
      dialogReturns({ mode: 'edit', firstName: 'Janet' });
      userService.updateUser.mockReturnValue(
        throwError(() => ({ error: { message: 'Email already in use' } })),
      );

      component.openEditUser(mockUser);

      expect(snackBarOpen).toHaveBeenCalledWith('Email already in use', 'Dismiss', {
        duration: 5000,
      });
    });

    it('should fall back to a generic message when the failure carries none', () => {
      dialogReturns({ mode: 'edit', firstName: 'Janet' });
      userService.updateUser.mockReturnValue(throwError(() => ({})));

      component.openEditUser(mockUser);

      expect(snackBarOpen).toHaveBeenCalledWith('Update failed', 'Dismiss', { duration: 5000 });
    });
  });

  describe('confirmDeleteUser', () => {
    it('should name the user in the confirmation it asks for', () => {
      component.confirmDeleteUser(mockUser);

      expect(dialogOpen).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          data: {
            title: 'Delete user',
            message: 'Delete user "jdoe"? This cannot be undone.',
            confirmLabel: 'Delete',
          },
        }),
      );
    });

    it('should not delete when the user declines', () => {
      dialogReturns(false);

      component.confirmDeleteUser(mockUser);

      expect(userService.deleteUser).not.toHaveBeenCalled();
    });

    it('should delete the user and confirm', () => {
      dialogReturns(true);

      component.confirmDeleteUser(mockUser);

      expect(userService.deleteUser).toHaveBeenCalledWith('jdoe');
      expect(snackBarOpen).toHaveBeenCalledWith('User deleted', 'Dismiss', { duration: 3000 });
    });

    it("should surface the server's message when the delete fails", () => {
      dialogReturns(true);
      userService.deleteUser.mockReturnValue(
        throwError(() => ({ error: { message: 'User owns documents' } })),
      );

      component.confirmDeleteUser(mockUser);

      expect(snackBarOpen).toHaveBeenCalledWith('User owns documents', 'Dismiss', {
        duration: 5000,
      });
    });

    it('should fall back to a generic message when the failure carries none', () => {
      dialogReturns(true);
      userService.deleteUser.mockReturnValue(throwError(() => ({})));

      component.confirmDeleteUser(mockUser);

      expect(snackBarOpen).toHaveBeenCalledWith('Delete failed', 'Dismiss', { duration: 5000 });
    });
  });

  describe('openCreateGroup', () => {
    it('should open the dialog in create mode', () => {
      component.openCreateGroup();

      expect(dialogOpen).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ data: { mode: 'create' } }),
      );
    });

    it('should do nothing when the dialog is cancelled', () => {
      dialogReturns(undefined);

      component.openCreateGroup();

      expect(userService.createGroup).not.toHaveBeenCalled();
    });

    it('should ignore a result from a different mode', () => {
      dialogReturns({ mode: 'edit', groupname: 'qa' });

      component.openCreateGroup();

      expect(userService.createGroup).not.toHaveBeenCalled();
    });

    it('should create the group and confirm', () => {
      dialogReturns({
        mode: 'create',
        groupname: 'qa',
        grouplabel: 'QA',
        memberUsers: ['jdoe'],
      });

      component.openCreateGroup();

      expect(userService.createGroup).toHaveBeenCalledWith({
        groupname: 'qa',
        grouplabel: 'QA',
        memberUsers: ['jdoe'],
      });
      expect(snackBarOpen).toHaveBeenCalledWith('Group created', 'Dismiss', { duration: 3000 });
    });

    it('should reopen the dialog when the user asked to create another', () => {
      dialogOpen
        .mockReturnValueOnce({
          afterClosed: () =>
            of({ mode: 'create', groupname: 'qa', grouplabel: 'QA', createAnother: true }),
        } as never)
        .mockReturnValueOnce({ afterClosed: () => of(undefined) } as never);

      component.openCreateGroup();

      expect(dialogOpen).toHaveBeenCalledTimes(2);
    });

    it('should not reopen the dialog when the create fails', () => {
      userService.createGroup.mockReturnValue(throwError(() => ({})));
      dialogOpen.mockReturnValue({
        afterClosed: () =>
          of({ mode: 'create', groupname: 'qa', grouplabel: 'QA', createAnother: true }),
      } as never);

      component.openCreateGroup();

      // Reopening after a failure would discard what the user typed and hide the error.
      expect(dialogOpen).toHaveBeenCalledTimes(1);
    });

    it("should surface the server's message when the create fails", () => {
      dialogReturns({ mode: 'create', groupname: 'qa', grouplabel: 'QA' });
      userService.createGroup.mockReturnValue(
        throwError(() => ({ error: { message: 'Group already exists' } })),
      );

      component.openCreateGroup();

      expect(snackBarOpen).toHaveBeenCalledWith('Group already exists', 'Dismiss', {
        duration: 5000,
      });
    });

    it('should fall back to a generic message when the failure carries none', () => {
      dialogReturns({ mode: 'create', groupname: 'qa', grouplabel: 'QA' });
      userService.createGroup.mockReturnValue(throwError(() => ({})));

      component.openCreateGroup();

      expect(snackBarOpen).toHaveBeenCalledWith('Create failed', 'Dismiss', { duration: 5000 });
    });
  });

  describe('openEditGroup', () => {
    it('should open the dialog in edit mode with the group', () => {
      component.openEditGroup(mockGroup);

      expect(dialogOpen).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ data: { mode: 'edit', group: mockGroup } }),
      );
    });

    it('should do nothing when the dialog is cancelled', () => {
      dialogReturns(undefined);

      component.openEditGroup(mockGroup);

      expect(userService.updateGroup).not.toHaveBeenCalled();
    });

    it('should ignore a result from a different mode', () => {
      dialogReturns({ mode: 'create', groupname: 'qa' });

      component.openEditGroup(mockGroup);

      expect(userService.updateGroup).not.toHaveBeenCalled();
    });

    it('should send the edited label and members, and confirm', () => {
      dialogReturns({ mode: 'edit', grouplabel: 'Reviewers v2', memberUsers: ['jdoe'] });

      component.openEditGroup(mockGroup);

      expect(userService.updateGroup).toHaveBeenCalledWith('reviewers', {
        grouplabel: 'Reviewers v2',
        memberUsers: ['jdoe'],
      });
      expect(snackBarOpen).toHaveBeenCalledWith('Group updated', 'Dismiss', { duration: 3000 });
    });

    it("should surface the server's message when the edit fails", () => {
      dialogReturns({ mode: 'edit', grouplabel: 'Reviewers v2' });
      userService.updateGroup.mockReturnValue(
        throwError(() => ({ error: { message: 'Group is read-only' } })),
      );

      component.openEditGroup(mockGroup);

      expect(snackBarOpen).toHaveBeenCalledWith('Group is read-only', 'Dismiss', {
        duration: 5000,
      });
    });

    it('should fall back to a generic message when the failure carries none', () => {
      dialogReturns({ mode: 'edit', grouplabel: 'Reviewers v2' });
      userService.updateGroup.mockReturnValue(throwError(() => ({})));

      component.openEditGroup(mockGroup);

      expect(snackBarOpen).toHaveBeenCalledWith('Update failed', 'Dismiss', { duration: 5000 });
    });
  });

  describe('confirmDeleteGroup', () => {
    it('should name the group in the confirmation it asks for', () => {
      component.confirmDeleteGroup(mockGroup);

      expect(dialogOpen).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          data: {
            title: 'Delete group',
            message: 'Delete group "reviewers"?',
            confirmLabel: 'Delete',
          },
        }),
      );
    });

    it('should not delete when the user declines', () => {
      dialogReturns(false);

      component.confirmDeleteGroup(mockGroup);

      expect(userService.deleteGroup).not.toHaveBeenCalled();
    });

    it('should delete the group and confirm', () => {
      dialogReturns(true);

      component.confirmDeleteGroup(mockGroup);

      expect(userService.deleteGroup).toHaveBeenCalledWith('reviewers');
      expect(snackBarOpen).toHaveBeenCalledWith('Group deleted', 'Dismiss', { duration: 3000 });
    });

    it("should surface the server's message when the delete fails", () => {
      dialogReturns(true);
      userService.deleteGroup.mockReturnValue(
        throwError(() => ({ error: { message: 'Group still has members' } })),
      );

      component.confirmDeleteGroup(mockGroup);

      expect(snackBarOpen).toHaveBeenCalledWith('Group still has members', 'Dismiss', {
        duration: 5000,
      });
    });

    it('should fall back to a generic message when the failure carries none', () => {
      dialogReturns(true);
      userService.deleteGroup.mockReturnValue(throwError(() => ({})));

      component.confirmDeleteGroup(mockGroup);

      expect(snackBarOpen).toHaveBeenCalledWith('Delete failed', 'Dismiss', { duration: 5000 });
    });
  });

  describe('refresh after a mutation', () => {
    it('should rerun the search immediately and reload the recent list after a delay', () => {
      dialogReturns(true);
      userService.searchUsersPaged.mockClear();
      userService.getRecentlyCreatedUsersAndGroups.mockClear();

      component.confirmDeleteUser(mockUser);

      expect(userService.searchUsersPaged).toHaveBeenCalled();
      // Audit indexing is asynchronous in Nuxeo, so the recent list is refetched a second later
      // rather than immediately — a same-tick reload would show the pre-deletion list.
      expect(userService.getRecentlyCreatedUsersAndGroups).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1000);

      expect(userService.getRecentlyCreatedUsersAndGroups).toHaveBeenCalled();
    });
  });

  describe('empty-state messages', () => {
    it('should point at the Groups tab when a search matched only groups', () => {
      component.combinedSearchQuery = 'reviewers';
      component.users.set([]);
      component.groupsTotal.set(1);

      expect(component.usersEmptyMessage()).toBe(
        'No users match this search. Matching groups are on the Groups tab.',
      );
    });

    it('should point at the Users tab when a search matched only users', () => {
      component.combinedSearchQuery = 'jdoe';
      component.groups.set([]);
      component.usersTotal.set(1);

      expect(component.groupsEmptyMessage()).toBe(
        'No groups match this search. Matching users are on the Users tab.',
      );
    });

    it('should not point at the other tab when nothing matched there either', () => {
      component.combinedSearchQuery = 'nothing';
      component.users.set([]);
      component.groups.set([]);
      component.usersTotal.set(0);
      component.groupsTotal.set(0);

      expect(component.usersEmptyMessage()).toBe('No users match this search.');
      expect(component.groupsEmptyMessage()).toBe('No groups match this search.');
    });

    it('should not point at the other tab with no search query', () => {
      component.combinedSearchQuery = '   ';
      component.users.set([]);
      component.groups.set([]);
      component.usersTotal.set(5);
      component.groupsTotal.set(5);

      expect(component.usersEmptyMessage()).toBe('No users match this search.');
      expect(component.groupsEmptyMessage()).toBe('No groups match this search.');
    });
  });

  describe('display helpers', () => {
    it('should join a first and last name for the display name', () => {
      expect(component.displayName(mockUser)).toBe('Jane Doe');
    });

    it('should fall back to the id when a user has no name', () => {
      expect(component.displayName({ id: 'asmith', properties: {} } as unknown as NuxeoUser)).toBe(
        'asmith',
      );
    });

    it('should use whichever name part is present', () => {
      expect(
        component.displayName({
          id: 'x',
          properties: { firstName: '  Jane  ', lastName: '  ' },
        } as unknown as NuxeoUser),
      ).toBe('Jane');
    });

    it("should join a user's groups for the groups column", () => {
      expect(component.groupsLabel(mockUser)).toBe('members, reviewers');
    });

    it('should render an empty groups column for a user in no groups', () => {
      expect(component.groupsLabel({ id: 'x', properties: {} } as unknown as NuxeoUser)).toBe('');
    });

    it("should list a group's member usernames", () => {
      expect(component.memberUsernames(mockGroup)).toEqual(['jdoe', 'asmith']);
    });

    it('should list no members for a group with none', () => {
      expect(component.memberUsernames({ groupname: 'x' } as NuxeoGroup)).toEqual([]);
    });
  });

  describe('members preview', () => {
    const bigGroup = {
      groupname: 'everyone',
      memberUsers: ['a', 'b', 'c', 'd', 'e'],
    } as unknown as NuxeoGroup;

    it('should show the first three members and count the rest', () => {
      expect(component.membersPreviewLeading(bigGroup)).toBe('a, b, c');
      expect(component.membersOverflowCount(bigGroup)).toBe(2);
      expect(component.membersOverflowUsernames(bigGroup)).toEqual(['d', 'e']);
    });

    it('should show every member when there are three or fewer', () => {
      const small = { groupname: 'pair', memberUsers: ['a', 'b'] } as unknown as NuxeoGroup;

      expect(component.membersPreviewLeading(small)).toBe('a, b');
      expect(component.membersOverflowCount(small)).toBe(0);
      expect(component.membersOverflowUsernames(small)).toEqual([]);
    });

    it('should render an em dash for a group with no members', () => {
      const empty = { groupname: 'empty', memberUsers: [] } as unknown as NuxeoGroup;

      expect(component.membersPreviewLeading(empty)).toBe('—');
      expect(component.membersPreview(empty)).toBe('—');
    });

    it('should summarise a long member list with a +n suffix', () => {
      expect(component.membersPreview(bigGroup)).toBe('a, b, c, +2');
    });

    it('should list a short member list in full', () => {
      expect(
        component.membersPreview({ groupname: 'x', memberUsers: ['a', 'b'] } as NuxeoGroup),
      ).toBe('a, b');
    });

    it('should pluralise the overflow aria-label', () => {
      expect(component.membersMoreAriaLabel(bigGroup)).toBe('Show 2 more members');
      expect(
        component.membersMoreAriaLabel({
          groupname: 'x',
          memberUsers: ['a', 'b', 'c', 'd'],
        } as NuxeoGroup),
      ).toBe('Show 1 more member');
    });
  });

  describe('members hover menu', () => {
    /** The slice of `MatMenuTrigger` this component drives. */
    function triggerStub(menuOpen = false) {
      return {
        menuOpen,
        openMenu: vi.fn(),
        closeMenu: vi.fn(),
      } as unknown as MatMenuTrigger;
    }

    it('should open a closed menu on hover', () => {
      const trigger = triggerStub(false);

      component.openMembersMenu(trigger);

      expect(trigger.openMenu).toHaveBeenCalled();
    });

    it('should not reopen a menu that is already open', () => {
      const trigger = triggerStub(true);

      component.openMembersMenu(trigger);

      expect(trigger.openMenu).not.toHaveBeenCalled();
    });

    it('should close the menu a short while after the pointer leaves', () => {
      const trigger = triggerStub(true);
      component.openMembersMenu(trigger);

      component.scheduleCloseMembersMenu(trigger);
      expect(trigger.closeMenu).not.toHaveBeenCalled();

      vi.advanceTimersByTime(200);
      expect(trigger.closeMenu).toHaveBeenCalled();
    });

    it('should cancel the close when the pointer enters the panel in time', () => {
      const trigger = triggerStub(true);
      component.openMembersMenu(trigger);
      component.scheduleCloseMembersMenu(trigger);

      // The gap between leaving the chip and entering the panel is what the delay exists for.
      component.onMembersMenuPanelEnter(trigger);
      vi.advanceTimersByTime(500);

      expect(trigger.closeMenu).not.toHaveBeenCalled();
    });

    it('should close the menu after the pointer leaves the panel', () => {
      const trigger = triggerStub(true);
      component.onMembersMenuPanelEnter(trigger);

      component.onMembersMenuPanelLeave(trigger);
      vi.advanceTimersByTime(200);

      expect(trigger.closeMenu).toHaveBeenCalled();
    });

    it('should not close a menu the pointer has since moved on from', () => {
      const first = triggerStub(true);
      const second = triggerStub(true);

      component.scheduleCloseMembersMenu(first);
      // Hovering a different row claims the hover before the timer fires.
      component.openMembersMenu(second);
      vi.advanceTimersByTime(500);

      expect(first.closeMenu).not.toHaveBeenCalled();
    });

    it('should drop a pending close when the component is destroyed', () => {
      const trigger = triggerStub(true);
      component.scheduleCloseMembersMenu(trigger);

      fixture.destroy();
      vi.advanceTimersByTime(500);

      // A timer that outlives the component would call into a destroyed view.
      expect(trigger.closeMenu).not.toHaveBeenCalled();
    });

    it('should replace an earlier pending close rather than stacking timers', () => {
      const trigger = triggerStub(true);
      component.openMembersMenu(trigger);

      component.scheduleCloseMembersMenu(trigger);
      component.scheduleCloseMembersMenu(trigger);
      vi.advanceTimersByTime(200);

      expect(trigger.closeMenu).toHaveBeenCalledTimes(1);
    });

    it('should be safe to cancel a close when none is pending', () => {
      expect(() => component.cancelCloseMembersMenu()).not.toThrow();
    });
  });
});
