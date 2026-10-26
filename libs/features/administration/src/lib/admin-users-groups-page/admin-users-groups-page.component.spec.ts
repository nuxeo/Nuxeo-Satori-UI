import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { testTranslateModule } from '@agentic-ui/testing/i18n';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatMenuTrigger } from '@angular/material/menu';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { UserService } from '@nuxeo/satori-platform/nuxeo-client';

import { AdminUsersGroupsPageComponent } from './admin-users-groups-page.component';

describe('AdminUsersGroupsPageComponent (NXSAT-166)', () => {
  let fixture: ComponentFixture<AdminUsersGroupsPageComponent>;

  const searchUsersPaged = vi
    .fn()
    .mockReturnValue(of({ 'entity-type': 'users', entries: [], totalSize: 0 }));
  const searchGroupsPaged = vi
    .fn()
    .mockReturnValue(of({ 'entity-type': 'groups', entries: [], totalSize: 0 }));
  const getRecentlyCreatedUsersAndGroups = vi.fn().mockReturnValue(
    of({
      entries: [
        {
          uid: 'poweruser02',
          title: 'poweruser02',
          type: 'user',
          path: '/',
          lastModified: '2026-07-01T00:00:00.000Z',
          properties: {
            'user:firstName': 'Power',
            'user:lastName': 'User Two',
            'user:email': 'pu02@example.com',
          },
        },
        {
          uid: 'poweruser01',
          title: 'poweruser01',
          type: 'user',
          path: '/',
          lastModified: '2026-06-30T00:00:00.000Z',
          properties: {
            'user:firstName': 'Power',
            'user:lastName': 'User One',
            'user:email': 'pu01@example.com',
          },
        },
        {
          uid: 'blabla',
          title: 'blabla',
          type: 'group',
          path: '/',
          lastModified: '2026-06-01T00:00:00.000Z',
          properties: { 'group:grouplabel': 'Bla Bla' },
        },
      ],
      totalSize: 3,
    }),
  );

  beforeEach(async () => {
    searchUsersPaged.mockClear();
    searchGroupsPaged.mockClear();
    getRecentlyCreatedUsersAndGroups.mockClear();

    await TestBed.configureTestingModule({
      imports: [
        testTranslateModule(),
        testTranslateModule(),
        AdminUsersGroupsPageComponent,
        NoopAnimationsModule,
      ],
      providers: [
        provideRouter([]),
        {
          provide: UserService,
          useValue: {
            searchUsersPaged,
            searchGroupsPaged,
            getRecentlyCreatedUsersAndGroups,
          },
        },
        {
          provide: MatDialog,
          useValue: { open: vi.fn() },
        },
        {
          provide: MatSnackBar,
          useValue: { open: vi.fn() },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminUsersGroupsPageComponent);
    fixture.detectChanges();
  });

  it('does not render a redundant header search button (NXSAT-166)', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.ug-page__header button[aria-label="Search"]')).toBeNull();
    expect(el.querySelectorAll('.ug-toolbar button[aria-label="Run search"]').length).toBe(1);
  });

  it('loads recently created users and groups in provider order (NXSAT-171)', () => {
    expect(getRecentlyCreatedUsersAndGroups).toHaveBeenCalledWith(50, 0);
    expect(fixture.componentInstance.recentRows().map((row) => row.identifier)).toEqual([
      'poweruser02',
      'poweruser01',
      'blabla',
    ]);
    expect(fixture.componentInstance.recentRows()[0]).toMatchObject({
      kind: 'user',
      name: 'Power User Two',
      email: 'pu02@example.com',
    });
    expect(fixture.componentInstance.recentRows()[2]).toMatchObject({
      kind: 'group',
      name: 'Bla Bla',
      identifier: 'blabla',
    });
  });

  it('refreshes recent list after mutation with audit indexing delay (NXSAT-171)', fakeAsync(() => {
    getRecentlyCreatedUsersAndGroups.mockClear();
    fixture.componentInstance['afterMutation']();
    expect(getRecentlyCreatedUsersAndGroups).not.toHaveBeenCalled();
    tick(1000);
    expect(getRecentlyCreatedUsersAndGroups).toHaveBeenCalledTimes(1);
  }));

  it('shows comma before overflow badge and opens members dropdown on hover', fakeAsync(() => {
    const groupWithManyMembers = {
      'entity-type': 'group' as const,
      groupname: 'powerusers',
      grouplabel: 'Power Users',
      memberUsers: ['u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7'],
      memberGroups: [],
    };
    searchGroupsPaged.mockReturnValue(
      of({
        'entity-type': 'groups',
        entries: [groupWithManyMembers],
        totalSize: 1,
      }),
    );

    fixture = TestBed.createComponent(AdminUsersGroupsPageComponent);
    fixture.detectChanges();
    tick();
    fixture.detectChanges();

    fixture.componentInstance.selectedTabIndex.set(1);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const membersCell = el.querySelector('td.mat-column-members');
    expect(membersCell?.textContent?.replace(/\s+/g, ' ').trim()).toContain('u1, u2, u3, +4');

    const moreDe = fixture.debugElement.query(By.css('.ug-members-more'));
    const moreBtn = moreDe.nativeElement as HTMLButtonElement;
    expect(moreBtn.textContent?.trim()).toBe('+4');

    const trigger = moreDe.injector.get(MatMenuTrigger);
    fixture.componentInstance.openMembersMenu(trigger);
    fixture.detectChanges();
    tick();

    const panel = document.querySelector('.ug-members-menu__panel');
    expect(panel).toBeTruthy();
    expect(panel?.textContent).toContain('u7');
    expect(panel?.textContent).not.toContain('u1');
    expect(panel?.textContent).not.toContain('more members');

    const items = document.querySelectorAll('button.ug-members-menu__item');
    expect(items.length).toBe(4);
    expect(items[0]?.textContent?.trim()).toBe('u4');
    expect(items[3]?.textContent?.trim()).toBe('u7');
    expect(items[0]?.tagName).toBe('BUTTON');
    expect(items[0]?.classList.contains('mat-mdc-menu-item')).toBe(true);
  }));

  it('lists overflow members only in dropdown helpers', () => {
    const component = fixture.componentInstance;
    const group = {
      'entity-type': 'group' as const,
      groupname: 'powerusers',
      grouplabel: 'Power Users',
      memberUsers: ['u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7'],
      memberGroups: [],
    };

    expect(component.membersOverflowCount(group)).toBe(4);
    expect(component.membersOverflowUsernames(group)).toEqual(['u4', 'u5', 'u6', 'u7']);
    expect(component.membersPreviewLeading(group)).toBe('u1, u2, u3');
    expect(component.membersPreview(group)).toBe('u1, u2, u3, +4');
    expect(component.membersMoreAriaLabel(group)).toBe('Show 4 more members');
  });
});
