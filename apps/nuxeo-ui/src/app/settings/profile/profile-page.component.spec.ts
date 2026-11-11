import { signal } from '@angular/core';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import { SettingsService, UserService, type NuxeoUser } from '@nuxeo/satori-platform/nuxeo-client';

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

  let userService: jasmine.SpyObj<Pick<UserService, 'getUser' | 'getGroup'>>;
  let settingsService: jasmine.SpyObj<Pick<SettingsService, 'getLocalPermissions'>>;

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

  it('shows only the own local permissions table, with no per-group permission cards', fakeAsync(() => {
    const fixture = TestBed.createComponent(ProfilePageComponent);
    fixture.detectChanges();
    tick();
    fixture.detectChanges();

    // Group ACEs (for example `members` on /default-domain/workspaces) are inherited by the user
    // and must not be listed on their profile. Count the cards, not the tables: a per-group card
    // renders its table only after its permissions load, so a table count stays at one even when
    // the card loop is reintroduced. Expected cards: primary profile, Groups, Local permissions.
    const cards = fixture.nativeElement.querySelectorAll('article.profile-card');
    expect(cards.length).toBe(3);
    const tables = fixture.nativeElement.querySelectorAll('table.profile-perm-table');
    expect(tables.length).toBe(1);
  }));
});
