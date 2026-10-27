import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import {
  DocumentDetailService,
  PrincipalPermissionsService,
  UserService,
} from '@nuxeo/satori-platform/nuxeo-client';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { AdminGroupDetailsPageComponent } from './admin-group-details-page.component';

describe('AdminGroupDetailsPageComponent', () => {
  let fixture: ComponentFixture<AdminGroupDetailsPageComponent>;
  const navigate = vi.fn(() => Promise.resolve(true));

  beforeEach(async () => {
    TestBed.resetTestingModule();
    vi.clearAllMocks();
    await TestBed.configureTestingModule({
      imports: [AdminGroupDetailsPageComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideTranslateService(),
        { provide: Router, useValue: { navigate } },
        {
          provide: UserService,
          useValue: {
            getGroup: () => of({ groupname: 'editors', memberUsers: [], memberGroups: [] }),
          },
        },
        {
          provide: PrincipalPermissionsService,
          useValue: {
            listLocalPermissionRows: () =>
              of({
                rows: [],
                totalDocuments: 0,
                numberOfPages: 0,
                currentPageIndex: 0,
                currentPageSize: 0,
              }),
          },
        },
        { provide: DocumentDetailService, useValue: { removePermission: () => of({}) } },
        { provide: MatDialog, useValue: { open: vi.fn() } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(AdminGroupDetailsPageComponent);
    fixture.componentRef.setInput('groupId', 'editors');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('renders the packaged page for the group name the route supplies', () => {
    expect(fixture.nativeElement.querySelector('nxs-admin-group-details-page')).not.toBeNull();
  });

  it('routes onward for each choice, and back to the list when deleted', () => {
    const page = fixture.componentInstance as unknown as {
      callbacks: {
        deleted(): void;
        userChosen(u: string): void;
        groupChosen(g: string): void;
        documentChosen(d: string): void;
      };
    };
    page.callbacks.userChosen('jdoe');
    page.callbacks.groupChosen('reviewers');
    page.callbacks.documentChosen('doc-1');
    page.callbacks.deleted();
    expect(navigate).toHaveBeenCalledWith(['/administration/users-groups/user', 'jdoe']);
    expect(navigate).toHaveBeenCalledWith(['/administration/users-groups/group', 'reviewers']);
    expect(navigate).toHaveBeenCalledWith(['/doc', 'doc-1']);
    expect(navigate).toHaveBeenCalledWith(['/administration/users-groups']);
  });
});
