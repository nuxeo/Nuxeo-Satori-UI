import { Component, provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { NXS_ADMIN_USERS_GROUPS_PAGE_ID } from '@nuxeo/satori-platform/components';
import { ExtensionComponentRegistry } from '@nuxeo/satori-platform/extensions';
import { UserService } from '@nuxeo/satori-platform/nuxeo-client';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { AdminUsersGroupsPageComponent } from './admin-users-groups-page.component';

/** A stand-in replacement, distinct from the packaged page so the assertions can tell them apart. */
@Component({
  selector: 'lib-replacement-users-groups-page',
  standalone: true,
  template: '<p>replacement</p>',
})
class ReplacementUsersGroupsPageComponent {}

describe('AdminUsersGroupsPageComponent', () => {
  let fixture: ComponentFixture<AdminUsersGroupsPageComponent>;
  const navigate = vi.fn(() => Promise.resolve(true));

  beforeEach(async () => {
    TestBed.resetTestingModule();
    vi.clearAllMocks();
    await TestBed.configureTestingModule({
      imports: [AdminUsersGroupsPageComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideTranslateService(),
        { provide: Router, useValue: { navigate } },
        {
          provide: UserService,
          useValue: {
            searchUsersPaged: () => of({ 'entity-type': 'users', entries: [], totalSize: 0 }),
            searchGroupsPaged: () => of({ 'entity-type': 'groups', entries: [], totalSize: 0 }),
            getRecentlyCreatedUsersAndGroups: () => of({ entries: [] }),
          },
        },
        { provide: MatDialog, useValue: { open: vi.fn() } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(AdminUsersGroupsPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('renders the packaged page when no registration resolves the ID', () => {
    expect(fixture.nativeElement.querySelector('nxs-admin-users-groups-page')).not.toBeNull();
  });

  it('renders a registered replacement in place of the packaged page', async () => {
    TestBed.inject(ExtensionComponentRegistry).register({
      [NXS_ADMIN_USERS_GROUPS_PAGE_ID]: ReplacementUsersGroupsPageComponent,
    });
    fixture = TestBed.createComponent(AdminUsersGroupsPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('lib-replacement-users-groups-page')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('nxs-admin-users-groups-page')).toBeNull();
  });

  it('routes to a user and to a group when either is chosen', () => {
    const page = fixture.componentInstance as unknown as {
      inputs: { userChosen(u: string): void; groupChosen(g: string): void };
    };
    page.inputs.userChosen('jdoe');
    page.inputs.groupChosen('editors');
    expect(navigate).toHaveBeenCalledWith(['/administration/users-groups/user', 'jdoe']);
    expect(navigate).toHaveBeenCalledWith(['/administration/users-groups/group', 'editors']);
  });
});
