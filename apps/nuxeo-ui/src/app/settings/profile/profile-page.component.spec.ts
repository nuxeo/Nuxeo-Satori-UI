import { signal } from '@angular/core';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import {
  PrincipalPermissionsService,
  SettingsService,
  UserService,
  type NuxeoUser,
  type PrincipalPermissionPage,
} from '@nuxeo/satori-platform/nuxeo-client';

import { AuthService } from '../../auth/auth.service';
import { ProfilePageComponent } from './profile-page.component';
import { testTranslateModule } from '../../i18n/translate-testing';

describe('ProfilePageComponent', () => {
  const mockUser: NuxeoUser = {
    'entity-type': 'user',
    id: 'poweruser02',
    properties: {
      firstName: 'Power',
      lastName: 'User',
      username: 'poweruser02',
      email: 'poweruser02@example.com',
      company: 'Hyland',
      groups: ['members', 'powerusers'],
    },
  };

  const membersPermPage: PrincipalPermissionPage = {
    rows: [
      {
        documentUid: 'sections-uid',
        documentTitle: 'Sections',
        documentPath: '/default-domain/sections',
        permission: 'CanAskForPublishing',
        begin: null,
        end: null,
        grantedBy: null,
        acePrincipal: 'group:members',
      },
      {
        documentUid: 'workspaces-uid',
        documentTitle: 'Workspaces',
        documentPath: '/default-domain/workspaces',
        permission: 'Read',
        begin: null,
        end: null,
        grantedBy: null,
        acePrincipal: 'group:members',
      },
    ],
    totalDocuments: 2,
    numberOfPages: 1,
    currentPageIndex: 0,
    currentPageSize: 25,
  };

  const emptyPermPage: PrincipalPermissionPage = {
    rows: [],
    totalDocuments: 0,
    numberOfPages: 0,
    currentPageIndex: 0,
    currentPageSize: 0,
  };

  let userService: jasmine.SpyObj<Pick<UserService, 'getUser' | 'getGroup'>>;
  let settingsService: jasmine.SpyObj<Pick<SettingsService, 'getLocalPermissions'>>;
  let permService: jasmine.SpyObj<Pick<PrincipalPermissionsService, 'listLocalPermissionRows'>>;

  beforeEach(async () => {
    userService = jasmine.createSpyObj('UserService', ['getUser', 'getGroup']);
    userService.getUser.and.returnValue(of(mockUser));
    userService.getGroup.and.callFake((groupId: string) =>
      of({
        'entity-type': 'group',
        groupname: groupId,
        grouplabel: groupId === 'members' ? 'Members' : 'Power Users',
      }),
    );

    settingsService = jasmine.createSpyObj('SettingsService', ['getLocalPermissions']);
    settingsService.getLocalPermissions.and.returnValue(of([]));

    permService = jasmine.createSpyObj('PrincipalPermissionsService', ['listLocalPermissionRows']);
    permService.listLocalPermissionRows.and.callFake((groupId: string) =>
      of(groupId === 'members' ? membersPermPage : emptyPermPage),
    );

    await TestBed.configureTestingModule({
      imports: [
        // `permissions.time-frame.permanent` is supplied here rather than widened into the
        // deliberately partial fallback map, so the assertion below reads the English a user sees
        // and would fail if the component stopped passing its resolver through.
        testTranslateModule({ 'permissions.time-frame.permanent': 'Permanent' }),
        ProfilePageComponent,
      ],
      providers: [
        { provide: AuthService, useValue: { username: signal('poweruser02') } },
        { provide: UserService, useValue: userService },
        { provide: SettingsService, useValue: settingsService },
        { provide: PrincipalPermissionsService, useValue: permService },
        { provide: MatDialog, useValue: { open: jasmine.createSpy('open') } },
      ],
    }).compileComponents();
  });

  it('loads and displays all user groups', fakeAsync(() => {
    const fixture = TestBed.createComponent(ProfilePageComponent);
    fixture.detectChanges();
    tick();

    const component = fixture.componentInstance;
    expect(component.groupsLoading()).toBe(false);
    expect(component.groups()).toEqual([
      { identifier: 'members', label: 'Members' },
      { identifier: 'powerusers', label: 'Power Users' },
    ]);
  }));

  it('loads group-inherited permissions when the section becomes visible', fakeAsync(() => {
    const fixture = TestBed.createComponent(ProfilePageComponent);
    fixture.detectChanges();
    tick();

    const component = fixture.componentInstance;
    expect(permService.listLocalPermissionRows).not.toHaveBeenCalled();

    component.onGroupPermSectionVisible('members');
    tick();

    expect(permService.listLocalPermissionRows).toHaveBeenCalledWith('members', 25, 0);
    expect(permService.listLocalPermissionRows).not.toHaveBeenCalledWith('powerusers', 25, 0);

    component.onGroupPermSectionVisible('powerusers');
    tick();

    expect(permService.listLocalPermissionRows).toHaveBeenCalledWith('powerusers', 25, 0);
    expect(component.groupPermRows('members')).toEqual([
      {
        documentTitle: 'Sections',
        documentPath: '/default-domain/sections',
        right: 'CanAskForPublishing',
        timeFrame: 'Permanent',
        grantedBy: '—',
      },
      {
        documentTitle: 'Workspaces',
        documentPath: '/default-domain/workspaces',
        right: 'Read',
        timeFrame: 'Permanent',
        grantedBy: '—',
      },
    ]);
    expect(component.groupPermRows('powerusers')).toEqual([]);
  }));
});
