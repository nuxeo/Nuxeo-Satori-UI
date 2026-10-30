import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { UserService, type NuxeoGroup, type NuxeoUser } from '@nuxeo/satori-platform/nuxeo-client';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { NxsAdminUsersGroupsPageComponent } from './admin-users-groups-page.component';

const USER = {
  id: 'jdoe',
  properties: { firstName: 'Jane', lastName: 'Doe', email: 'jdoe@acme.test', groups: ['members'] },
} as unknown as NuxeoUser;

const GROUP = {
  groupname: 'editors',
  grouplabel: 'Editors',
  memberUsers: ['a', 'b', 'c', 'd', 'e'],
} as unknown as NuxeoGroup;

/** The English the page shows, so the spec can find its rows and messages. */
const ENGLISH: Record<string, string> = {
  'satori-components.admin-users-groups-page.could-not-load-groups': 'Could not load groups.',
  'satori-components.admin-users-groups-page.could-not-load-users': 'Could not load users.',
  'satori-components.admin-users-groups-page.create-failed': 'Could not create the group.',
  'satori-components.admin-users-groups-page.delete': 'Delete',
  'satori-components.admin-users-groups-page.delete-failed': 'Delete failed',
  'satori-components.admin-users-groups-page.delete-group': 'Delete group',
  'satori-components.admin-users-groups-page.delete-group-aria': 'Delete group {{ name }}',
  'satori-components.admin-users-groups-page.delete-group-named': 'Delete group "{{ name }}"?',
  'satori-components.admin-users-groups-page.delete-user': 'Delete user',
  'satori-components.admin-users-groups-page.delete-user-aria': 'Delete user {{ name }}',
  'satori-components.admin-users-groups-page.delete-user-named':
    'Delete user "{{ name }}"? This cannot be undone.',
  'satori-components.admin-users-groups-page.edit': 'Edit',
  'satori-components.admin-users-groups-page.edit-group': 'Edit group {{ name }}',
  'satori-components.admin-users-groups-page.edit-user': 'Edit user {{ name }}',
  'satori-components.admin-users-groups-page.email': 'Email',
  'satori-components.admin-users-groups-page.group': 'Group',
  'satori-components.admin-users-groups-page.group-created': 'Group created',
  'satori-components.admin-users-groups-page.group-deleted': 'Group deleted',
  'satori-components.admin-users-groups-page.group-updated': 'Group saved',
  'satori-components.admin-users-groups-page.groups': 'Groups',
  'satori-components.admin-users-groups-page.groups-tab': 'Groups ({{ count }})',
  'satori-components.admin-users-groups-page.identifier': 'Identifier',
  'satori-components.admin-users-groups-page.invitation-sent': 'Invitation sent',
  'satori-components.admin-users-groups-page.label': 'Label',
  'satori-components.admin-users-groups-page.loading': 'Loading',
  'satori-components.admin-users-groups-page.members': 'Members',
  'satori-components.admin-users-groups-page.name': 'Name',
  'satori-components.admin-users-groups-page.new': 'New',
  'satori-components.admin-users-groups-page.new-group': 'New group',
  'satori-components.admin-users-groups-page.new-user': 'New user',
  'satori-components.admin-users-groups-page.no-groups': 'No groups match this search.',
  'satori-components.admin-users-groups-page.no-recent': 'No recent user or group.',
  'satori-components.admin-users-groups-page.no-users': 'No users match this search.',
  'satori-components.admin-users-groups-page.recent': 'Recently created users and groups',
  'satori-components.admin-users-groups-page.run-search': 'Run search',
  'satori-components.admin-users-groups-page.search': 'Search for users and groups',
  'satori-components.admin-users-groups-page.title': 'Users & Groups',
  'satori-components.admin-users-groups-page.update-failed': 'Could not save the changes.',
  'satori-components.admin-users-groups-page.user-created': 'User created',
  'satori-components.admin-users-groups-page.user-deleted': 'User deleted',
  'satori-components.admin-users-groups-page.user-updated': 'User saved',
  'satori-components.admin-users-groups-page.username': 'Username',
  'satori-components.admin-users-groups-page.users-tab': 'Users ({{ count }})',
};

/** The component's methods that the template calls, reached by element access. */
type Page = Record<string, (...args: unknown[]) => unknown> & {
  query: { set(value: string): void };
  selectedTab(): number;
};

describe('NxsAdminUsersGroupsPageComponent', () => {
  let fixture: ComponentFixture<NxsAdminUsersGroupsPageComponent>;
  let userService: Record<string, ReturnType<typeof vi.fn>>;
  /** What the next dialog closes with, in order. */
  let dialogResults: unknown[];

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const text = (): string => el().textContent ?? '';
  const page = (): Page => fixture.componentInstance as unknown as Page;
  /** Opens the Groups tab: the table lives in a tab body that is only rendered when selected. */
  const showGroups = (): void => {
    (
      fixture.componentInstance as unknown as { selectedTab: { set(v: number): void } }
    ).selectedTab.set(1);
    fixture.detectChanges();
  };
  const link = (label: string): HTMLButtonElement | undefined =>
    Array.from(el().querySelectorAll('button')).find((b) => b.textContent?.trim() === label) as
      HTMLButtonElement | undefined;

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    TestBed.resetTestingModule();
    vi.clearAllMocks();
    dialogResults = [];
    userService = {
      searchUsersPaged: vi.fn(() => of({ 'entity-type': 'users', entries: [USER], totalSize: 1 })),
      searchGroupsPaged: vi.fn(() =>
        of({ 'entity-type': 'groups', entries: [GROUP], totalSize: 1 }),
      ),
      getRecentlyCreatedUsersAndGroups: vi.fn(() => of({ entries: [] })),
      updateUser: vi.fn(() => of({})),
      deleteUser: vi.fn(() => of({})),
      createGroup: vi.fn(() => of({})),
      updateGroup: vi.fn(() => of({})),
      deleteGroup: vi.fn(() => of({})),
    };
    const dialog = {
      open: vi.fn(() => ({ afterClosed: () => of(dialogResults.shift()) })),
    };
    await TestBed.configureTestingModule({
      imports: [NxsAdminUsersGroupsPageComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideTranslateService(),
        { provide: UserService, useValue: userService },
        { provide: MatDialog, useValue: dialog },
      ],
    }).compileComponents();
    TestBed.inject(TranslateService).setTranslation('en', ENGLISH);
    TestBed.inject(TranslateService).use('en');
    fixture = TestBed.createComponent(NxsAdminUsersGroupsPageComponent);
    await render();
  });

  it('searches users and groups on start, and shows both', () => {
    expect(userService['searchUsersPaged']).toHaveBeenCalledWith('', 20, 0);
    expect(userService['searchGroupsPaged']).toHaveBeenCalledWith('', 20, 0);
    expect(text()).toContain('jdoe');
    expect(text()).toContain('Jane Doe');
    showGroups();
    expect(text()).toContain('Editors');
  });

  it('shows the first three members of a group and counts the rest', () => {
    showGroups();
    expect(text()).toContain('a, b, c, +2');
  });

  it('calls its callback with the username when a user is chosen', () => {
    const emitted: string[] = [];
    fixture.componentRef.setInput('userChosen', (id: string) => emitted.push(id));
    link('jdoe')?.click();
    expect(emitted).toEqual(['jdoe']);
  });

  it('calls its callback with the group name when a group is chosen', async () => {
    const emitted: string[] = [];
    fixture.componentRef.setInput('groupChosen', (id: string) => emitted.push(id));
    showGroups();
    await render();
    link('editors')?.click();
    expect(emitted).toEqual(['editors']);
  });

  it('shows the outcome of a deletion and refreshes the list', async () => {
    dialogResults.push(true);
    page()['deleteUser'](USER);
    await render();
    expect(userService['deleteUser']).toHaveBeenCalledWith('jdoe');
    expect(text()).toContain('User deleted');
  });

  it('does not delete when the confirmation is refused', async () => {
    dialogResults.push(undefined);
    page()['deleteUser'](USER);
    await render();
    expect(userService['deleteUser']).not.toHaveBeenCalled();
  });

  it('keeps a failed deletion on screen as an alert', async () => {
    dialogResults.push(true);
    userService['deleteUser'].mockReturnValue(throwError(() => new Error('nope')));
    page()['deleteUser'](USER);
    await render();
    expect(el().querySelector('[role="alert"]')?.textContent).toContain('Delete failed');
  });

  it('saves an edited user with the values the dialog returned', async () => {
    dialogResults.push({
      mode: 'edit',
      username: 'jdoe',
      firstName: 'Janet',
      lastName: 'Doe',
      company: '',
      email: 'jdoe@acme.test',
      groups: ['members'],
    });
    page()['openEditUser'](USER);
    await render();
    expect(userService['updateUser']).toHaveBeenCalledWith(
      'jdoe',
      expect.objectContaining({ firstName: 'Janet' }),
    );
    expect(text()).toContain('User saved');
  });

  it('creates a group and reports it', async () => {
    dialogResults.push({
      mode: 'create',
      groupname: 'admins',
      grouplabel: 'Admins',
      memberUsers: ['jdoe'],
    });
    page()['openCreateGroup']();
    await render();
    expect(userService['createGroup']).toHaveBeenCalledWith({
      groupname: 'admins',
      grouplabel: 'Admins',
      memberUsers: ['jdoe'],
    });
    expect(text()).toContain('Group created');
  });

  it('reports a refused group creation as an alert', async () => {
    dialogResults.push({ mode: 'create', groupname: 'admins', grouplabel: '', memberUsers: [] });
    userService['createGroup'].mockReturnValue(throwError(() => new Error('x')));
    page()['openCreateGroup']();
    await render();
    expect(el().querySelector('[role="alert"]')?.textContent).toContain(
      'Could not create the group.',
    );
  });

  it('saves an edited group', async () => {
    dialogResults.push({
      mode: 'edit',
      groupname: 'editors',
      grouplabel: 'Editors 2',
      memberUsers: ['a'],
    });
    page()['openEditGroup'](GROUP);
    await render();
    expect(userService['updateGroup']).toHaveBeenCalledWith('editors', {
      grouplabel: 'Editors 2',
      memberUsers: ['a'],
    });
  });

  it('deletes a group after confirmation', async () => {
    dialogResults.push(true);
    page()['deleteGroup'](GROUP);
    await render();
    expect(userService['deleteGroup']).toHaveBeenCalledWith('editors');
    expect(text()).toContain('Group deleted');
  });

  it('shows an alert when the user list cannot be loaded', async () => {
    userService['searchUsersPaged'].mockReturnValue(throwError(() => new Error('down')));
    page()['runSearch']();
    await render();
    expect(text()).toContain('Could not load users.');
  });

  it('moves a search that found only groups to the Groups tab', async () => {
    userService['searchUsersPaged'].mockReturnValue(
      of({ 'entity-type': 'users', entries: [], totalSize: 0 }),
    );
    page().query.set('edit');
    page()['runSearch']();
    await render();
    expect(page().selectedTab()).toBe(1);
  });

  it('replaces the status line on each outcome, so a repeated message is announced again', async () => {
    page()['finish']('some.outcome', false);
    await render();
    const first = el().querySelector('.nxs-ugp__status');
    page()['finish']('some.outcome', false);
    await render();
    const second = el().querySelector('.nxs-ugp__status');
    expect(second).not.toBe(first);
    expect(second?.textContent).toContain('some.outcome');
  });
  it('reports a failed user page change and empties the list', async () => {
    userService['searchUsersPaged'].mockReturnValueOnce(throwError(() => new Error('down')));
    page()['onUsersPage']({ pageIndex: 1, pageSize: 10, length: 20 });
    await render();
    expect(page()['usersError']()).toBe(true);
    expect(page()['users']()).toEqual([]);
  });

  it('loads the next group page, and reports a failed one', async () => {
    page()['onGroupsPage']({ pageIndex: 1, pageSize: 10, length: 20 });
    await render();
    expect(userService['searchGroupsPaged']).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.any(Number),
      1,
    );
    userService['searchGroupsPaged'].mockReturnValueOnce(throwError(() => new Error('down')));
    page()['onGroupsPage']({ pageIndex: 2, pageSize: 10, length: 30 });
    await render();
    expect(page()['groupsError']()).toBe(true);
  });

  it('shows no recent rows when the recent list cannot be loaded', async () => {
    userService['getRecentlyCreatedUsersAndGroups'].mockReturnValueOnce(
      throwError(() => new Error('down')),
    );
    page()['loadRecent']();
    await render();
    expect(page()['recent']()).toEqual([]);
    expect(page()['recentLoading']()).toBe(false);
  });

  it('routes a recent user or group to its callback', () => {
    const userChosen = vi.fn();
    const groupChosen = vi.fn();
    fixture.componentRef.setInput('userChosen', userChosen);
    fixture.componentRef.setInput('groupChosen', groupChosen);
    page()['openRecent']({ kind: 'user', name: 'Jane', identifier: 'jdoe', email: '' });
    page()['openRecent']({ kind: 'group', name: 'Editors', identifier: 'editors', email: '' });
    expect(userChosen).toHaveBeenCalledWith('jdoe');
    expect(groupChosen).toHaveBeenCalledWith('editors');
  });

  it('moves the recent list to the page it is asked for', () => {
    page()['onRecentPage']({ pageIndex: 2, pageSize: 10, length: 30 });
    expect(page()['recentPage']()).toBe(2);
  });

  it('reports an invitation sent', async () => {
    dialogResults.push({ mode: 'create', username: 'newbie', invited: true, createAnother: false });
    page()['openCreateUser']();
    await render();
    expect(page()['status']()).toEqual({
      text: 'satori-components.admin-users-groups-page.invitation-sent',
      error: false,
    });
  });

  it('opens the create dialog again when the admin asks to create another user', async () => {
    dialogResults.push(
      { mode: 'create', username: 'newbie', invited: false, createAnother: true },
      undefined,
    );
    page()['openCreateUser']();
    await render();
    expect(page()['status']()).toEqual({
      text: 'satori-components.admin-users-groups-page.user-created',
      error: false,
    });
  });

  it('reports a refused user update as an alert', async () => {
    dialogResults.push({
      mode: 'edit',
      username: 'jdoe',
      firstName: 'J',
      lastName: 'D',
      company: '',
      email: 'j@acme.test',
      groups: [],
    });
    userService['updateUser'].mockReturnValueOnce(throwError(() => new Error('no')));
    page()['openEditUser'](USER);
    await render();
    expect(page()['status']()).toEqual({
      text: 'satori-components.admin-users-groups-page.update-failed',
      error: true,
    });
  });

  it('reports a refused group update and a refused group deletion as alerts', async () => {
    dialogResults.push({
      mode: 'edit',
      groupname: 'editors',
      grouplabel: 'Editors',
      memberUsers: [],
    });
    userService['updateGroup'].mockReturnValueOnce(throwError(() => new Error('no')));
    page()['openEditGroup'](GROUP);
    await render();
    expect(page()['status']()).toEqual({
      text: 'satori-components.admin-users-groups-page.update-failed',
      error: true,
    });
    dialogResults.push(true);
    userService['deleteGroup'].mockReturnValueOnce(throwError(() => new Error('no')));
    page()['deleteGroup'](GROUP);
    await render();
    expect(page()['status']()).toEqual({
      text: 'satori-components.admin-users-groups-page.delete-failed',
      error: true,
    });
  });
});
